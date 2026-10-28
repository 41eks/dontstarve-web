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


def import_shard(shard, template, supported, catalog, origin_cell=None, snapshot=None, expected_prefab=None,
                 source_session=None):
    source_shard = shard
    shard = shard.resolve()
    if source_session is None:
        index = LITERALS['returned_table']((shard / 'save/shardindex').read_text())
        session_id = index['session_id']
        session = shard / 'save/session' / session_id
        source_path = source_shard / 'save/session' / session_id
    else:
        session_id = source_session.name
        session = source_session.resolve()
        source_path = source_session
    if not isinstance(session_id, str) or not session_id.isalnum():
        raise ValueError('Invalid session ID')
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
        source_player = LITERALS['player_snapshot'](player_source.read_text(encoding='utf-8', errors='surrogateescape'))
        position, player['inventory']['containers'], player_report = PLAYER['convert_player'](
            source_player,
            report['translation'], result['world']['map']['generator']['options']['size'],
            f'dst_{session_id}_{user.name}', catalog)
        player['transform']['position'] = position
        migration = (source_player.get('data') or {}).get('migration')
        if migration is not None and (not isinstance(migration, dict)
                                      or set(migration) - {'worldid', 'portalid', 'sessionid', 'dest_x', 'dest_y', 'dest_z'}
                                      or type(migration.get('worldid')) is not str
                                      or type(migration.get('portalid')) is not int
                                      or type(migration.get('sessionid')) is not str):
            raise ValueError(f'Unsupported player migration in {player_source}')
        result['session']['playerFile'] = f'{shard.name}/save/session/{session_id}/{user.name}/{snapshot}.json'
        report['player'] = {'source': f'{source_path.as_posix()}/{user.name}/{snapshot}',
                            'sourceSha256': hashlib.sha256(player_source.read_bytes()).hexdigest(),
                            'migration': migration, **player_report}
    result['session']['id'] = f'{terrain["prefab"]}-{session_id}-map-v1'
    result['snapshot'] = {**result['snapshot'], 'id': snapshot, 'parentId': None, 'reason': 'initial'}
    report['source'] = f'{source_path.as_posix()}/{snapshot}'
    report['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    if expected_prefab is not None and terrain['prefab'] != expected_prefab:
        raise ValueError(f'{shard} must contain {expected_prefab} terrain')
    return result, report


def cluster_snapshots(cluster):
    """Every world Snapshot, including Session copies stored under another physical shard."""
    found = {}
    for physical in ('Master', 'Caves'):
        root = cluster / physical / 'save/session'
        if not root.is_dir():
            continue
        for session in sorted(path for path in root.iterdir() if path.is_dir()):
            for source in sorted(path for path in session.iterdir() if path.is_file()
                                 and len(path.name) == 10 and path.name.isdigit()):
                prefab = LITERALS['snapshot_map'](source.read_text())['prefab']
                if prefab not in TILE['SHARDS']:
                    continue
                shard = TILE['SHARDS'][prefab][0]
                key = shard, session.name, source.name
                if key in found:
                    if source.read_bytes() != found[key].read_bytes():
                        raise ValueError(f'Conflicting source snapshots for {key}')
                    continue
                found[key] = source
    if not found:
        raise ValueError('No forest or cave snapshots found in cluster')
    return sorted(found.items())


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
    parser.add_argument('--snapshot', help='Ten-digit snapshot with --shard; --cluster imports every snapshot')
    parser.add_argument('--check', action='store_true', help='Verify both save and provenance without writing')
    args = parser.parse_args()
    if args.forest_origin_cell is not None and args.cluster is None:
        parser.error('--forest-origin-cell requires --cluster')
    if args.snapshot is not None and args.cluster is not None:
        parser.error('--snapshot requires --shard')
    if args.cluster is not None and (args.output.suffix.lower() == '.json' or args.output.is_file()):
        parser.error('--output must be a directory with --cluster')
    template = json.loads(args.template.read_text())
    supported = {name: spec['tileId'] for name, spec in json.loads(
        (ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    supported['FAKE_GROUND'] = 200
    # The save loader's item catalog lives in TypeScript; validate player items against the same specs.
    catalog = json.loads(subprocess.run(['node', str(ROOT / 'scripts/export-save-catalog.mjs')],
                                        check=True, capture_output=True, text=True).stdout)
    if args.shard:
        jobs = [(args.shard, args.output, args.origin_cell, args.snapshot, None, None)]
    else:
        jobs = []
        for (shard, session_id, snapshot), source in cluster_snapshots(args.cluster):
            prefab = 'cave' if shard == 'Caves' else 'forest'
            jobs.append((args.cluster / shard, args.output / shard / 'save/session' / session_id / f'{snapshot}.json',
                         args.origin_cell if prefab == 'cave' else args.forest_origin_cell,
                         snapshot, prefab, source.parent))
    # Convert every source before replacing any output file.
    imports = [(output, *import_shard(shard, template, supported, catalog, origin, snapshot, prefab, source_session))
               for shard, output, origin, snapshot, prefab, source_session in jobs]
    latest = {}
    for output, result, report in imports:
        key = result['world']['shardId'], result['session']['id']
        if key not in latest or result['snapshot']['id'] > latest[key][1]['snapshot']['id']:
            latest[key] = (output, result, report)
    active = [result['world']['prefab'] for _, result, report in latest.values()
              if report.get('player') and report['player']['migration'] is None]
    if len(active) > 1:
        raise ValueError(f'Player is active in multiple shards: {active}')
    if args.cluster and not active and any(report.get('player') for _, _, report in imports):
        raise ValueError('No active player Session found in the cluster')
    manifest = []
    for output, result, report in imports:
        player_file = result['session'].get('playerFile')
        if player_file:
            write_or_check(args.output / player_file if args.cluster else output.parent / player_file,
                           {'player': result['players']['local'], 'migration': report['player']['migration']}, args.check)
        world = {**result, 'players': {}} if args.cluster or player_file else result
        write_or_check(output, world, args.check)
        write_or_check(output.with_suffix('.import.json'), report, args.check)
        if args.cluster:
            manifest.append({'shard': 'Caves' if result['world']['prefab'] == 'cave' else 'Master',
                             'sessionId': output.parent.name, 'snapshotId': result['snapshot']['id'],
                             'worldFile': output.relative_to(args.output).as_posix(),
                             'playerFile': player_file,
                             'migration': report.get('player', {}).get('migration')})
        print(f'{"Checked" if args.check else "Imported"} {result["world"]["prefab"]}: {report["landCells"]} land cells '
              f'from {len(report["nodes"])} nodes and {sum(len(records) for records in result["world"]["entities"].values())} '
              f'whitelisted entities into {output}')
        ground = report['groundItemCounts']
        print(f'  Static ground art: {len(ground)} prefabs, {sum(item["entities"] for item in ground.values())} entities, '
              f'{sum(item["quantity"] for item in ground.values())} total items')
    if args.cluster:
        for shard in ('Master', 'Caves'):
            matching = [(output, result, report) for output, result, report in latest.values()
                        if result['world']['prefab'] == ('cave' if shard == 'Caves' else 'forest')]
            if len(matching) != 1:
                raise ValueError(f'Expected one {shard} Session, found {len(matching)}')
            _, result, report = matching[0]
            write_or_check(args.output / f'{shard}.json', {**result, 'players': {}}, args.check)
            write_or_check(args.output / f'{shard}.import.json', report, args.check)
        write_or_check(args.output / 'session.json',
                       {'activeShard': 'Caves' if active == ['cave'] else 'Master', 'snapshots': manifest}, args.check)


if __name__ == '__main__':
    main()
