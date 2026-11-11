"""Build the examine and announce strings from the DST Lua sources: chinese_s.po's STRINGS.CHARACTERS and ARCHIVE_RUNE_STATUE entries."""
import argparse
import json
from pathlib import Path
import re

# wilson speaks STRINGS.CHARACTERS.GENERIC; only playable characters with their own speech are kept.
CHARACTERS = ('GENERIC', 'WORTOX')
CHARACTER_KEYS = ('DESCRIBE', 'DESCRIBE_GENERIC', 'DESCRIBE_TOODARK', 'DESCRIBE_SMOLDERING',
                  # SGwilson.lua tent: GetString(inst, failreason).
                  'ANNOUNCE_NODAYSLEEP', 'ANNOUNCE_NONIGHTSIESTA', 'ANNOUNCE_NOSLEEPONFIRE', 'ANNOUNCE_NOHUNGERSLEEP')
ENTRY = re.compile(r'msgctxt "((?:[^"\\]|\\.)*)"\nmsgid "((?:[^"\\]|\\.)*)"\nmsgstr "((?:[^"\\]|\\.)*)"')


def wanted(path):
    if path[:2] == ['STRINGS', 'ARCHIVE_RUNE_STATUE']:
        return path[1:]
    if path[:2] == ['STRINGS', 'CHARACTERS'] and len(path) > 3 and path[2] in CHARACTERS and path[3] in CHARACTER_KEYS:
        return path[1:]
    return None


def lists(node):
    """A Lua table of numbered lines stays a list, as `#topic_tab` reads it."""
    if not isinstance(node, dict):
        return node
    if node and all(key.isdigit() for key in node):
        return [lists(node[key]) for key in sorted(node, key=int)]
    return {key: lists(value) for key, value in sorted(node.items())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    po = (args.source / 'databundles/scripts_unpacked/scripts/languages/chinese_s.po').read_text(encoding='utf8')
    strings = {}
    count = 0
    for context, msgid, msgstr in ENTRY.findall(po):
        path = wanted(context.split('.'))
        if path is None:
            continue
        node = strings
        for key in path[:-1]:
            node = node.setdefault(key, {})
        node[path[-1]] = json.loads(f'"{msgstr or msgid}"', strict=False)
        count += 1
    generic = strings['CHARACTERS']['GENERIC']
    if not {'BIRDCAGE', 'ROCK', 'EVERGREEN'} <= set(generic['DESCRIBE']) or 'DESCRIBE_GENERIC' not in generic:
        raise ValueError('Missing supported examine strings')
    target = Path(__file__).resolve().parents[2] / 'componets/src/strings.json'
    text = json.dumps(lists(strings), ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if target.read_text(encoding='utf8') != text:
            raise ValueError(f'{target} differs from the source strings')
    else:
        target.write_text(text, encoding='utf8')
    print(f'{"Checked" if args.check else "Imported"} {count} strings')


if __name__ == '__main__':
    main()
