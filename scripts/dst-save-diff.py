#!/usr/bin/env python3
"""Summarize how an imported save directory differs from a git ref.

    python3 scripts/dst-save-diff.py --expect pillar_cave monkeypillar
    python3 scripts/dst-save-diff.py --base HEAD~1 --output public/saves/Cluster_1

Run it after regenerating saves, before committing. Worlds are compared per entity
group and import reports per prefab, so the output stays small however large the
files are. With --expect, the exit status is 1 if anything outside those prefab IDs
changed, or if an expected ID changed nowhere.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB_REPORT_KEYS = ('entityWhitelist', 'entityCounts', 'entitySources')


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True).stdout


def changed_paths(repo, base, output):
    """Repo-relative JSON paths under output that differ from base, as {path: status}."""
    relative = output.resolve().relative_to(repo.resolve()).as_posix()
    changes = {}
    for line in git(repo, 'diff', '--no-renames', '--name-status', base, '--', relative).decode().splitlines():
        status, path = line.split('\t', 1)
        changes[path] = status
    for path in git(repo, 'ls-files', '--others', '--exclude-standard', '--', relative).decode().splitlines():
        changes[path] = 'A'
    tracked = git(repo, 'ls-tree', '-r', '--name-only', base, '--', relative).decode().splitlines()
    return {path: status for path, status in changes.items() if path.endswith('.json')}, len(tracked)


def compare_groups(before, after):
    """{group: (kind, before count, after count)} for differing groups."""
    groups = {}
    for name in sorted(set(before) | set(after)):
        old, new = before.get(name), after.get(name)
        if old == new:
            continue
        if old is None:
            kind = 'added'
        elif new is None:
            kind = 'removed'
        else:
            kind = 'changed'
        groups[name] = (kind, len(old or ()), len(new or ()))
    return groups


def compare_report(before, after):
    """Prefab IDs and non-prefab report keys that differ between two .import.json files."""
    prefabs, other = set(), []
    for key in sorted(set(before) | set(after)):
        old, new = before.get(key), after.get(key)
        if old == new:
            continue
        if key == 'entityCounts':
            prefabs |= {name for name in set(old or {}) | set(new or {}) if (old or {}).get(name) != (new or {}).get(name)}
        elif key == 'entityWhitelist':
            prefabs |= set(old or ()) ^ set(new or ())
        elif key == 'entitySources':
            pairs = lambda rows: {json.dumps(row, sort_keys=True): row['prefab'] for row in rows or ()}
            old_rows, new_rows = pairs(old), pairs(new)
            prefabs |= {new_rows[row] for row in new_rows.keys() - old_rows.keys()}
            prefabs |= {old_rows[row] for row in old_rows.keys() - new_rows.keys()}
        else:
            other.append(key)
    return prefabs, other


def compare_world(before, after):
    """Entity groups and any other differing key paths of a world save."""
    old_world, new_world = before.get('world') or {}, after.get('world') or {}
    groups = compare_groups(old_world.get('entities') or {}, new_world.get('entities') or {})
    other = [key for key in sorted(set(before) | set(after)) if key != 'world' and before.get(key) != after.get(key)]
    other += [f'world.{key}' for key in sorted(set(old_world) | set(new_world))
              if key != 'entities' and old_world.get(key) != new_world.get(key)]
    return groups, other


def latest_counts(directory, ids):
    """source/imported counts and component fields from each world's latest-snapshot copy."""
    rows = []
    for report in sorted(directory.glob('*.import.json')):
        counts = json.loads(report.read_text()).get('entityCounts') or {}
        world = report.with_name(report.name.replace('.import.json', '.json'))
        entities = (json.loads(world.read_text()).get('world') or {}).get('entities') or {} if world.exists() else {}
        for name in sorted(ids):
            count = counts.get(name) or {}
            records = entities.get(name) or []
            if not count.get('source') and not count.get('imported') and not records:
                continue
            fields = {}
            for record in records:
                for key in record.get('components') or {}:
                    fields[key] = fields.get(key, 0) + 1
            rendered = ' '.join(f'{key}={value}' for key, value in sorted(fields.items()))
            rows.append(f'  {report.name.split(".")[0]} {name} {count.get("source")}/{count.get("imported")} '
                        f'of {len(records)} records, components: {rendered or "-"}')
    return rows


def run(repo, base, output, expect):
    changes, tracked = changed_paths(repo, base, output)
    prefix = output.resolve().relative_to(repo.resolve()).as_posix() + '/'
    summary, other_changes, unreadable = {}, [], []
    for path, status in sorted(changes.items()):
        file = repo / path
        short = path.removeprefix(prefix)
        if status == 'A' or status == 'D':
            other_changes.append(f'{short}: file {"added" if status == "A" else "removed"}')
            continue
        try:
            before = json.loads(git(repo, 'show', f'{base}:{path}'))
            after = json.loads(file.read_text())
        except (json.JSONDecodeError, subprocess.CalledProcessError) as error:
            unreadable.append(f'{short}: {error}')
            continue
        if path.endswith('.import.json'):
            prefabs, other = compare_report(before, after)
            for name in prefabs:
                summary.setdefault(name, {'reports': 0, 'worlds': {}})['reports'] += 1
        elif 'world' in before or 'world' in after:
            groups, other = compare_world(before, after)
            for name, change in groups.items():
                entry = summary.setdefault(name, {'reports': 0, 'worlds': {}})
                entry['worlds'][change] = entry['worlds'].get(change, 0) + 1
        else:
            other = [key for key in sorted(set(before) | set(after)) if before.get(key) != after.get(key)]
        other_changes += [f'{short}: {key}' for key in other]

    print(f'{prefix} vs {base}: {len(changes)} JSON files changed; {tracked} files tracked at base')
    for name, entry in sorted(summary.items()):
        worlds = ', '.join(f'{kind} {old}->{new} in {count} worlds'
                           for (kind, old, new), count in sorted(entry['worlds'].items()))
        marker = '' if not expect or name in expect else ' UNEXPECTED'
        print(f'  {name}: {worlds or "no world change"}; {entry["reports"]} reports{marker}')
    if not summary:
        print('  no entity groups changed')

    problems = [f'unreadable {line}' for line in unreadable]
    if expect:
        problems += [f'unexpected entity group: {name}' for name in sorted(set(summary) - expect)]
        problems += [f'expected but unchanged: {name}' for name in sorted(expect - set(summary))]
    if other_changes:
        print(f'other changes ({len(other_changes)}):')
        print('\n'.join(f'  {line}' for line in other_changes[:40]))
        if len(other_changes) > 40:
            print(f'  ... {len(other_changes) - 40} more')
        if expect:
            problems.append(f'{len(other_changes)} non-entity changes')
    rows = latest_counts(output, expect or set(summary))
    if rows:
        print('latest snapshot (source/imported counts):')
        print('\n'.join(rows))
    print(f'problems: {len(problems)}')
    for problem in problems:
        print(f'  {problem}')
    return 1 if problems else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', default='HEAD', help='git ref to compare the working tree against (default HEAD)')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/saves/Cluster_1', help='imported save directory')
    parser.add_argument('--expect', nargs='+', default=[], metavar='ID', help='prefab IDs allowed to change')
    args = parser.parse_args(argv)
    repo = Path(git(args.output, 'rev-parse', '--show-toplevel').decode().strip())
    return run(repo, args.base, args.output, set(args.expect))


if __name__ == '__main__':
    sys.exit(main())
