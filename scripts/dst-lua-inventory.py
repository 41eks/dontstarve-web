#!/usr/bin/env python3
"""Print what a DST prefab's Lua declares, so a port rarely has to read the whole file.

    python3 scripts/dst-lua-inventory.py pillar_cave archive_pillar
    python3 scripts/dst-lua-inventory.py hats --fn '^(onequip|fn)$'

Each line is `L<line> <enclosing function> [?] <code>`; `?` marks code inside an
`if`/loop in that function. Commented-out code is ignored. Make* helpers are expanded
from standardcomponents.lua and components from components/<name>.lua, because both
can add tags and listeners. This is a line scan, not a Lua parser: read the listed branches before
relying on them, and a helper from another file only shows up as its call.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCRIPTS = Path('/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts')
LIFECYCLE = ('OnSave', 'OnLoad', 'OnLoadPostPass', 'OnPreLoad', 'OnEntitySleep', 'OnEntityWake', 'OnRemoveEntity')
CATEGORIES = (
    ('prefabs', r'\b(Prefab|MakePlacer)\s*\('),
    ('assets', r'\bAsset\s*\('),
    ('bank/build', r':(SetBank|SetBuild|SetBankAndPlayAnimation|AddOverrideBuild|OverrideSymbol|OverrideItemSkinSymbol|SetSkin)\s*\('),
    ('animation', r':(PlayAnimation|PushAnimation|SetBankAndPlayAnimation|SetPercent|SetFrame|SetTime|SetDeltaTimeMultiplier)\s*\('),
    ('tags', r':(AddTag|RemoveTag|AddOrRemoveTag)\s*\('),
    ('make', r'(?<!function )\bMake[A-Z]\w*\s*\('),
    ('components', r':AddComponent\s*\('),
    ('events', r':(ListenForEvent|WatchWorldState|SetStateGraph|SetBrain)\s*\('),
    ('tasks', r':(DoTaskInTime|DoPeriodicTask|DoStaticTaskInTime)\s*\('),
    ('callbacks', r':Set\w*(Fn|Callback)\s*\(|\.components\.\w+\.on\w+\s*='),
    ('display', r':(SetFinalOffset|SetLayer|SetSortOrder|SetBloomEffectHandle|SetLightOverride|SetIcon|SetScale|SetSymbolBloom\w*)\s*\(|\.entity:Add(Light|SoundEmitter|MiniMapEntity|DynamicShadow)\s*\('),
    ('physics/light', r'\.(Physics|Light):\w+\s*\('),
    ('lifecycle', r'\.(' + '|'.join(LIFECYCLE) + r')\s*='),
)
COMPILED = [(name, re.compile(pattern)) for name, pattern in CATEGORIES]
FUNCTION = re.compile(r'^(?:local\s+)?function\s+([\w.:]+)\s*\(([^)]*)\)|^(?:local\s+)?([\w.:]+)\s*=\s*function\s*\(([^)]*)\)')
TAG_ARG = re.compile(r''':(?:AddTag|AddOrRemoveTag)\s*\(\s*["']([^"']+)["']''')
MAKE_CALL = re.compile(r'(?<!function )(?<![:.])\b(Make[A-Z]\w*)\s*\(')
EVENT = re.compile(r''':(?:ListenForEvent|WatchWorldState)\s*\(\s*["']([^"']+)["']''')
COMPONENT = re.compile(r''':AddComponent\s*\(\s*["'](\w+)["']''')


def strip_comments(source):
    """Blank Lua comments, keeping line numbers and leaving strings alone."""
    out, i, quote = [], 0, None
    while i < len(source):
        char = source[i]
        if quote:
            out.append(char)
            if char == '\\':
                out.append(source[i + 1:i + 2])
                i += 1
            elif char == quote or char == '\n':
                quote = None
        elif char in '"\'':
            quote = char
            out.append(char)
        elif source.startswith('--', i):
            long = re.match(r'--\[(=*)\[', source[i:])
            if long:
                end = source.find(f']{long.group(1)}]', i)
                end = len(source) if end < 0 else end + len(long.group(1)) + 2
            else:
                end = source.find('\n', i)
                end = len(source) if end < 0 else end
            out.append('\n' * source.count('\n', i, end))
            i = end
            continue
        else:
            out.append(char)
        i += 1
    return ''.join(out)


def scan(source):
    """Return (lineno, enclosing function, conditional, stripped code) and function spans."""
    lines, stack, spans = [], [], {}
    for lineno, raw in enumerate(strip_comments(source).split('\n'), 1):
        code = raw.strip()
        if not code:
            continue
        indent = len(raw.expandtabs(4)) - len(raw.expandtabs(4).lstrip())
        if re.match(r'end\b', code):
            while stack and stack[-1]['indent'] >= indent:
                closed = stack.pop()
                if closed['kind'] == 'function':
                    spans.setdefault(closed['name'], []).append((closed['start'], lineno, closed['params']))
        names = [entry['name'] for entry in stack if entry['kind'] == 'function']
        conditional = False
        for entry in reversed(stack):
            if entry['kind'] == 'function':
                break
            conditional = True
        lines.append((lineno, names[-1] if names else '-', conditional, code))
        opens = not re.search(r'\bend\b[\s,)]*$', code)
        match = FUNCTION.match(code)
        if match and opens:
            name, params = (match.group(1), match.group(2)) if match.group(1) else (match.group(3), match.group(4))
            stack.append({'kind': 'function', 'indent': indent, 'name': name, 'start': lineno,
                          'params': [param.strip() for param in params.split(',')]})
        elif re.match(r'(if|for|while)\b', code) and opens:
            stack.append({'kind': 'block', 'indent': indent, 'name': '', 'start': lineno, 'params': []})
    return lines, spans


def save_fields(lines, spans):
    """data.<field> read or written by the functions assigned to the save/load hooks."""
    fields = {}
    for hook in ('OnSave', 'OnPreLoad', 'OnLoad', 'OnLoadPostPass'):
        targets = set()
        for _, _, _, code in lines:
            match = re.search(rf'\.{hook}\s*=\s*([\w.:]+)', code)
            if match:
                targets.add(f'inst.{hook}' if match.group(1) == 'function' else match.group(1))
        found = []
        for target in targets:
            for start, end, params in spans.get(target, []):
                if len(params) < 2:
                    continue
                pattern = re.compile(rf'\b{re.escape(params[1])}\.(\w+)')
                for lineno, _, _, code in lines:
                    if start <= lineno <= end:
                        found += [name for name in pattern.findall(code) if name not in found]
        if found:
            fields[hook] = found
    return fields


class Source:
    def __init__(self, scripts):
        self.scripts = scripts
        self.prefab_files = sorted((scripts / 'prefabs').glob('*.lua'))
        standard = scripts / 'standardcomponents.lua'
        self.standard_lines, self.standard_spans = scan(standard.read_text(errors='replace')) if standard.exists() else ([], {})
        skins = scripts / 'prefabs/skinprefabs.lua'
        self.skins = skins.read_text(errors='replace') if skins.exists() else ''
        self.classes = {}
        for directory in (ROOT / 'packages/componets/src', ROOT / 'packages/prefab/src/components'):
            for path in directory.rglob('*.ts') if directory.exists() else ():
                for name in re.findall(r'^export\s+class\s+(\w+)', path.read_text(errors='replace'), re.M):
                    self.classes.setdefault(name.lower(), f'{name} ({path.relative_to(ROOT)})')

    def resolve(self, target):
        path = Path(target)
        if path.suffix == '.lua':
            return [path if path.exists() else self.scripts / target]
        exact, mentioned, listed = [], [], []
        literal = re.compile(rf'''\bPrefab\s*\(\s*["']{re.escape(target)}["']''')
        quoted = re.compile(rf'''["']{re.escape(target)}["']''')
        for file in self.prefab_files:
            text = strip_comments(file.read_text(errors='replace'))
            if literal.search(text):
                exact.append(file)
            elif re.search(r'\bPrefab\s*\(', text) and quoted.search(text):
                # A bare `"id",` line only depends on the prefab; a call passing the ID defines it.
                calls = any(quoted.search(line) and not re.fullmatch(r'''\s*["'][^"']*["']\s*,?\s*''', line)
                            for line in text.split('\n'))
                (mentioned if calls else listed).append(file)
        stem = [file for file in self.prefab_files if file.stem == target]
        return exact or stem or mentioned or listed

    def make_details(self, name, seen=None):
        """Tags, components and events of a standardcomponents.lua helper and the helpers it calls."""
        seen = seen if seen is not None else set()
        if name not in self.standard_spans:
            return None
        details = {'tags': [], 'calls': [], 'components': [], 'events': []}
        if name in seen:
            return details
        seen.add(name)
        for start, end, _ in self.standard_spans[name]:
            for lineno, _, _, code in self.standard_lines:
                if not start <= lineno <= end:
                    continue
                details['tags'] += TAG_ARG.findall(code)
                details['components'] += COMPONENT.findall(code)
                details['events'] += EVENT.findall(code)
                for called in MAKE_CALL.findall(code):
                    details['calls'].append(called)
                    for key, values in (self.make_details(called, seen) or {}).items():
                        details[key] += values
        return details

    def component_tags(self, name):
        """Tags added inside the component's Class(function(self, inst) ... end) constructor."""
        path = self.scripts / 'components' / f'{name}.lua'
        if not path.exists():
            return None
        tags, inside = [], False
        for raw in strip_comments(path.read_text(errors='replace')).split('\n'):
            if not inside and re.search(r'=\s*Class\(function\b', raw):
                inside = True
            elif inside and re.match(r'end\b', raw):
                break
            elif inside:
                tags += TAG_ARG.findall(raw)
        return tags


def report(path, source, fn_filter, width):
    lines, spans = scan(path.read_text(errors='replace'))
    if fn_filter:
        selected = [line for line in lines if fn_filter.search(line[1])]
    else:
        selected = lines
    try:
        label = path.relative_to(source.scripts)
    except ValueError:
        label = path
    print(f'## {label} ({len(lines)} code lines)')
    for category, pattern in COMPILED:
        hits = [line for line in selected if pattern.search(line[3])]
        if not hits:
            continue
        print(f'{category}:')
        for lineno, name, conditional, code in hits:
            text = code if len(code) <= width else code[:width - 1] + '…'
            print(f'  L{lineno} {name}{" ?" if conditional else ""} {text}')

    fields = save_fields(lines, spans)
    print('save fields: ' + ('; '.join(f'{hook}: {", ".join(names)}' for hook, names in fields.items()) or 'none found'))

    makes = sorted({name for line in selected for name in MAKE_CALL.findall(line[3])} - set(spans))
    if makes:
        print('make helpers:')
        for name in makes:
            details = source.make_details(name)
            if details is None:
                print(f'  {name}: not in standardcomponents.lua')
                continue
            parts = [f'{key} {", ".join(dict.fromkeys(values))}' for key, values in details.items() if values]
            print(f'  {name}: ' + ('; '.join(parts) or 'no tags, components or events'))

    components = sorted({name for line in selected for name in COMPONENT.findall(line[3])})
    if components:
        print('components:')
        for name in components:
            tags = source.component_tags(name)
            state = 'no Lua file' if tags is None else 'ctor tags ' + (', '.join(dict.fromkeys(tags)) or 'none')
            print(f'  {name}: {state}; TS {source.classes.get(name.lower(), "missing")}')

    prefabs = re.findall(r'''\bPrefab\s*\(\s*["']([^"']+)["']''', path.read_text(errors='replace'))
    skins = {name: len(re.findall(rf'base_prefab\s*=\s*"{re.escape(name)}"', source.skins)) for name in prefabs}
    print('skins: ' + (', '.join(f'{name} {count}' for name, count in skins.items() if count) or 'none for literal Prefab() names in this file'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('targets', nargs='+', help='prefab ID, or a .lua path (relative to --scripts or absolute)')
    parser.add_argument('--scripts', type=Path, default=DEFAULT_SCRIPTS, help='DST scripts directory')
    parser.add_argument('--fn', type=re.compile, help='only list lines whose enclosing function matches this regex')
    parser.add_argument('--width', type=int, default=110, help='truncate code to this many characters')
    args = parser.parse_args(argv)

    source = Source(args.scripts)
    files, missing = {}, []
    for target in args.targets:
        found = source.resolve(target)
        if not found or not all(path.exists() for path in found):
            missing.append(target)
            continue
        if len(found) > 1:
            print(f'{target}: {len(found)} candidates: ' + ', '.join(path.name for path in found) + f'; using {found[0].name}')
        files.setdefault(found[0], []).append(target)
    for path, targets in files.items():
        print(f'# {", ".join(targets)}')
        report(path, source, args.fn, args.width)
    if missing:
        print('not found: ' + ', '.join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
