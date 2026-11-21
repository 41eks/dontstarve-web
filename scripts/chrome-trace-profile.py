#!/usr/bin/env python3
"""Summarize a Chrome DevTools performance trace (Trace-*.json.gz) of the game's main thread.

    python3 scripts/chrome-trace-profile.py summary Trace-20261116T231003.json.gz
    python3 scripts/chrome-trace-profile.py summary Trace.json.gz --top 80 --self-top 30 --frames 12
    python3 scripts/chrome-trace-profile.py callees Trace.json.gz "update prefabDisplay.ts:412"
    python3 scripts/chrome-trace-profile.py threads Trace.json.gz

The main thread is the busiest CrRendererMain; the measured window spans its first to last
FireAnimationFrame, and per-frame figures divide by that frame count.

- summary: fps, rAF duration percentiles, main-thread busy share, GC time, the JS functions with
  the most inclusive and self time (ms/frame), and what the longest frames spent their time in.
- callees: for samples under one function (a label exactly as summary prints it), the time of its
  direct callees, the next two levels and its callers.
- threads: busy time and top trace events on every thread, and GPU/compositor frame event counts.

V8 inlines small functions into their callers, so their time shows under the caller.
"""
import argparse
import bisect
import collections
import gzip
import json
import sys

GC_EVENTS = ('V8.GC_MC_INCREMENTAL', 'MajorGC', 'MinorGC', 'V8.GCScavenger', 'V8.GCFinalizeMC')
FRAME_NOISE = ('(root)', '(program)', 'tick animate', '(anon) animate')


class Trace:
    def __init__(self, path):
        data = json.load(gzip.open(path))
        self.events = data['traceEvents'] if isinstance(data, dict) else data
        self.thread_names = {
            (e['pid'], e['tid']): e['args']['name']
            for e in self.events if e.get('ph') == 'M' and e.get('name') == 'thread_name'
        }
        busy = collections.Counter()
        for e in self.events:
            if e.get('ph') == 'X' and e.get('name') == 'RunTask' and self.thread_names.get((e['pid'], e['tid'])) == 'CrRendererMain':
                busy[(e['pid'], e['tid'])] += e['dur']
        if not busy:
            sys.exit('no CrRendererMain tasks in the trace')
        self.pid, self.tid = busy.most_common(1)[0][0]
        self.frames = [e for e in self.main_events() if e.get('name') == 'FireAnimationFrame' and e.get('ph') == 'X']
        if not self.frames:
            sys.exit('no FireAnimationFrame on the main thread')
        self.start = min(e['ts'] for e in self.frames)
        self.end = max(e['ts'] + e['dur'] for e in self.frames)
        self.gcs = [e for e in self.main_events() if e.get('ph') == 'X' and e.get('name') in GC_EVENTS]
        self._load_profile()

    def main_events(self):
        return (e for e in self.events if e.get('pid') == self.pid and e.get('tid') == self.tid)

    def _load_profile(self):
        profile = next((e for e in self.main_events() if e.get('name') == 'Profile'), None)
        if profile is None:
            sys.exit('no CPU profile on the main thread; record with JavaScript samples enabled')
        self.nodes, self.samples, deltas = {}, [], []
        for e in self.events:
            if e.get('name') == 'ProfileChunk' and e.get('id') == profile['id'] and e.get('pid') == self.pid:
                chunk = e['args']['data']
                for node in chunk.get('cpuProfile', {}).get('nodes', []):
                    self.nodes[node['id']] = node
                self.samples += chunk.get('cpuProfile', {}).get('samples', [])
                deltas += chunk.get('timeDeltas', [])
        self.parent = {node['id']: node.get('parent') for node in self.nodes.values()}
        # A sample's duration is the gap to the next sample.
        self.durations = deltas[1:] + [0]
        self.times, t = [], profile['args']['data']['startTime']
        for delta in deltas:
            t += delta
            self.times.append(t)
        self._labels = {}

    def label(self, node_id):
        label = self._labels.get(node_id)
        if label is None:
            frame = self.nodes[node_id]['callFrame']
            source = frame.get('url', '').split('/')[-1].split('?')[0]
            label = f"{frame.get('functionName') or '(anon)'} {source}:{frame.get('lineNumber', 0) + 1}"
            self._labels[node_id] = label
        return label

    def stack(self, node_id):
        """Labels from the sampled frame out to the root."""
        labels = []
        while node_id:
            labels.append(self.label(node_id))
            node_id = self.parent.get(node_id)
        return labels

    def sample_range(self, start, end):
        return range(bisect.bisect_left(self.times, start), bisect.bisect_left(self.times, end))

    def inclusive(self, indices):
        totals = collections.Counter()
        for k in indices:
            for label in set(self.stack(self.samples[k])):
                totals[label] += self.durations[k]
        return totals


def summary(trace, top, self_top, longest):
    frames, span = len(trace.frames), (trace.end - trace.start) / 1e6
    durations = sorted(e['dur'] / 1000 for e in trace.frames)
    pct = lambda q: durations[min(len(durations) - 1, int(len(durations) * q))]
    print(f'main thread {trace.pid}/{trace.tid}; rAF window {span:.1f}s, {frames} frames = {frames / span:.1f} fps')
    print(f'rAF ms: median {pct(.5):.1f} p90 {pct(.9):.1f} p99 {pct(.99):.1f} max {durations[-1]:.1f}')
    tasks = sum(e['dur'] for e in trace.main_events()
                if e.get('name') == 'RunTask' and e.get('ph') == 'X' and trace.start <= e['ts'] <= trace.end)
    print(f'main thread busy {100 * tasks / (trace.end - trace.start):.0f}%')
    gc = sum(e['dur'] for e in trace.gcs if trace.start <= e['ts'] <= trace.end)
    print(f'GC on main thread: {gc / 1000:.0f} ms ({gc / 1000 / frames:.2f} ms/frame)')

    busy = [k for k in trace.sample_range(trace.start, trace.end) if not trace.label(trace.samples[k]).startswith('(idle)')]
    total = sum(trace.durations[k] for k in busy)
    inclusive = trace.inclusive(busy)
    own = collections.Counter()
    for k in busy:
        own[trace.label(trace.samples[k])] += trace.durations[k]
    print(f'profiled JS busy {total / 1e6:.1f}s = {total / 1000 / frames:.2f} ms/frame')
    print('--- inclusive, ms/frame')
    for label, value in inclusive.most_common(top):
        print(f'{value / 1000 / frames:6.2f}  {100 * value / total:5.1f}%  {label}')
    print('--- self, ms/frame')
    for label, value in own.most_common(self_top):
        print(f'{value / 1000 / frames:6.2f}  {label}')
    print('--- longest frames: ms, GC ms, top inclusive functions')
    for frame in sorted(trace.frames, key=lambda e: -e['dur'])[:longest]:
        start, end = frame['ts'], frame['ts'] + frame['dur']
        spent = trace.inclusive(trace.sample_range(start, end))
        gc = sum(e['dur'] for e in trace.gcs if start <= e['ts'] < end) / 1000
        picks = [(label, round(value / 1000, 1)) for label, value in spent.most_common(40) if not label.startswith(FRAME_NOISE)][:5]
        print(f"{frame['dur'] / 1000:6.1f}  gc {gc:4.1f}  {picks}")


def callees(trace, target, top):
    frames = len(trace.frames)
    direct, two, callers, total = collections.Counter(), collections.Counter(), collections.Counter(), 0
    for k, node in enumerate(trace.samples):
        chain = trace.stack(node)[::-1]
        if target not in chain:
            continue
        # The outermost occurrence, so recursion is not counted twice.
        i, duration = chain.index(target), trace.durations[k]
        total += duration
        direct[chain[i + 1] if i + 1 < len(chain) else '(self)'] += duration
        two[' > '.join(chain[i + 1:i + 3]) or '(self)'] += duration
        callers[' < '.join(reversed(chain[max(0, i - 2):i])) or '(root)'] += duration
    if not total:
        sys.exit(f'no samples under {target!r}; pass a label exactly as summary prints it')
    print(f'{target}: {total / 1000 / frames:.2f} ms/frame')
    for title, counter, count in (('direct callees', direct, top), ('two levels', two, top), ('callers', callers, 6)):
        print(f'-- {title}')
        for label, value in counter.most_common(count):
            print(f'  {value / 1000 / frames:5.2f}  {label}')


def threads(trace):
    per_thread = collections.defaultdict(collections.Counter)
    for e in trace.events:
        if e.get('ph') == 'X' and 'dur' in e:
            per_thread[(e['pid'], e['tid'])][e['name']] += e['dur']
    for key, counter in sorted(per_thread.items(), key=lambda item: -sum(item[1].values())):
        busy = sum(counter.values())
        if busy < 500_000:
            continue
        top = ', '.join(f'{name} {value / 1000:.0f}ms' for name, value in counter.most_common(6))
        print(f'{trace.thread_names.get(key, "?")} {key[0]}/{key[1]}: {top}')
    span = (trace.end - trace.start) / 1e6
    print(f'rAF window {span:.1f}s, {len(trace.frames) / span:.1f} fps')
    for name in ('DrawFrame', 'Display::DrawAndSwap', 'Graphics.Pipeline', 'PipelineReporter'):
        count = sum(1 for e in trace.events if e.get('name') == name and trace.start <= e.get('ts', 0) <= trace.end)
        print(f'{name}: {count}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('summary', help='frame stats and the hottest functions')
    p.add_argument('trace')
    p.add_argument('--top', type=int, default=45, help='inclusive functions to list')
    p.add_argument('--self-top', type=int, default=20, help='self-time functions to list')
    p.add_argument('--frames', type=int, default=8, help='longest frames to break down')
    p = commands.add_parser('callees', help='where one function spends its time')
    p.add_argument('trace')
    p.add_argument('function', help='label as summary prints it, e.g. "update prefabDisplay.ts:412"')
    p.add_argument('--top', type=int, default=15)
    p = commands.add_parser('threads', help='busy time per thread and GPU frame events')
    p.add_argument('trace')
    args = parser.parse_args()
    trace = Trace(args.trace)
    if args.command == 'summary':
        summary(trace, args.top, args.self_top, args.frames)
    elif args.command == 'callees':
        callees(trace, args.function, args.top)
    else:
        threads(trace)


if __name__ == '__main__':
    main()
