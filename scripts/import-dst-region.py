#!/usr/bin/env python3
"""Import DST forest/cave maps, whitelisted entities and the player's position and inventory into project shard saves."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
LITERALS = runpy.run_path(str(SCRIPTS / 'dst-save-literal.py'))
# Each part owns its source -> project conversion: tiles (map, coordinates, spawn), prefabs (entities), player.
TILE = runpy.run_path(str(SCRIPTS / 'dst-region-tile.py'))
PREFAB = runpy.run_path(str(SCRIPTS / 'dst-region-prefab.py'))
PLAYER = runpy.run_path(str(SCRIPTS / 'dst-region-player.py'))


def convert(terrain, template, supported, origin_cell=None):
    """The template's save shell with the converted map and a reset local player at its spawn."""
    world, spawn_position, report = TILE['convert_map'](terrain, supported, origin_cell)
    result = json.loads(json.dumps(template))
    result['world'] = world
    PLAYER['reset_player'](result['players']['local'], world['shardId'], spawn_position)
    return result, report


def write_or_check(path, data, check):
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if check:
        if not path.is_file() or path.read_text() != serialized:
            raise ValueError(f'{path} differs from the source import')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized)


def import_shard(shard, template, supported, catalog, origin_cell=None, snapshot=None, expected_prefab=None):
    source_shard = shard
    shard = shard.resolve()
    index = LITERALS['returned_table']((shard / 'save/shardindex').read_text())
    session_id = index['session_id']
    if not isinstance(session_id, str) or not session_id.isalnum():
        raise ValueError('Invalid session ID')
    session = shard / 'save/session' / session_id
    candidates = sorted(p for p in session.iterdir() if p.is_file() and len(p.name) == 10 and p.name.isdigit())
    if not candidates:
        raise ValueError('No world snapshots found')
    snapshot = snapshot or candidates[-1].name
    if len(snapshot) != 10 or not snapshot.isdigit():
        raise ValueError('Snapshot must contain ten digits')
    source = session / snapshot
    source_text = source.read_text()
    terrain = LITERALS['snapshot_map'](source_text)
    result, report = convert(terrain, template, supported, origin_cell)
    source_entities = LITERALS['snapshot_entities'](source_text, PREFAB['source_prefabs']())
    result['world']['entities'], entity_report = PREFAB['convert_entities'](
        terrain, source_entities, report, session_id, catalog)
    report.update(entity_report)
    user, player_source = PLAYER['player_snapshot'](session, snapshot)
    if player_source is not None:
        player = result['players']['local']
        position, player['inventory']['containers'], player_report = PLAYER['convert_player'](
            LITERALS['player_snapshot'](player_source.read_text(encoding='utf-8', errors='surrogateescape')),
            report['translation'], result['world']['map']['generator']['options']['size'],
            f'dst_{session_id}_{user.name}', catalog)
        player['transform']['position'] = position
        report['player'] = {'source': f'{source_shard.as_posix()}/save/session/{session_id}/{user.name}/{snapshot}',
                            'sourceSha256': hashlib.sha256(player_source.read_bytes()).hexdigest(), **player_report}
    result['session']['id'] = f'{terrain["prefab"]}-{session_id}-map-v1'
    result['snapshot'] = {**result['snapshot'], 'id': snapshot, 'parentId': None, 'reason': 'initial'}
    report['source'] = f'{source_shard.as_posix()}/save/session/{session_id}/{snapshot}'
    report['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    if expected_prefab is not None and terrain['prefab'] != expected_prefab:
        raise ValueError(f'{shard} must contain {expected_prefab} terrain')
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument('--shard', type=Path, help='DST Master or Caves shard directory')
    sources.add_argument('--cluster', type=Path, help='DST cluster directory; import both Master and Caves')
    parser.add_argument('--output', required=True, type=Path,
                        help='Save JSON path with --shard; output directory with --cluster')
    parser.add_argument('--template', type=Path, default=ROOT / 'public/saves/initial-world.json')
    parser.add_argument('--origin-cell', nargs=2, type=int, metavar=('COL', 'ROW'),
                        help='Source origin for --shard; caves origin for --cluster (forest is centred independently)')
    parser.add_argument('--forest-origin-cell', nargs=2, type=int, metavar=('COL', 'ROW'),
                        help='Forest source origin with --cluster')
    parser.add_argument('--snapshot', help='Ten-digit snapshot; defaults to latest in each active session')
    parser.add_argument('--check', action='store_true', help='Verify both save and provenance without writing')
    args = parser.parse_args()
    if args.forest_origin_cell is not None and args.cluster is None:
        parser.error('--forest-origin-cell requires --cluster')
    if args.cluster is not None and (args.output.suffix.lower() == '.json' or args.output.is_file()):
        parser.error('--output must be a directory with --cluster')
    template = json.loads(args.template.read_text())
    supported = {name: spec['tileId'] for name, spec in json.loads(
        (ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    supported['FAKE_GROUND'] = 200
    # The save loader's item catalog lives in TypeScript; validate player items against the same specs.
    catalog = json.loads(subprocess.run(['node', str(ROOT / 'scripts/export-save-catalog.mjs')],
                                        check=True, capture_output=True, text=True).stdout)
    jobs = [(args.shard, args.output, args.origin_cell, None)] if args.shard else [
        (args.cluster / name, args.output / f'{name}.json',
         args.forest_origin_cell if prefab == 'forest' else args.origin_cell, prefab)
        for prefab, (name, _) in TILE['SHARDS'].items()]
    # Convert/validate every shard before replacing any output file.
    imports = [(output, *import_shard(shard, template, supported, catalog, origin, args.snapshot, prefab))
               for shard, output, origin, prefab in jobs]
    for output, result, report in imports:
        write_or_check(output, result, args.check)
        write_or_check(output.with_suffix('.import.json'), report, args.check)
        print(f'{"Checked" if args.check else "Imported"} {result["world"]["prefab"]}: {report["landCells"]} land cells '
              f'from {len(report["nodes"])} nodes and {sum(len(records) for records in result["world"]["entities"].values())} '
              f'whitelisted entities into {output}')
        ground = report['groundItemCounts']
        print(f'  Static ground art: {len(ground)} prefabs, {sum(item["entities"] for item in ground.values())} entities, '
              f'{sum(item["quantity"] for item in ground.values())} total items')


if __name__ == '__main__':
    main()
