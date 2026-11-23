#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic==2.14.4", "typing-extensions>=4.14,<5"]
# ///
"""Import DST forest/cave maps, whitelisted entities and the player's position and inventory into project shard saves."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
from typing import Any, cast

from dst_save_schema import (
    PLAYER_SESSION_FILE,
    SAVE_CATALOG,
    SAVE_DOCUMENT,
    SESSION_ID,
    SESSION_MANIFEST,
    SNAPSHOT_ID,
    SOURCE_MIGRATION,
    WORLD_SESSION_FILE,
    PlayerMigration,
    SaveCatalog,
    SaveDocument,
    SavedPlayer,
    SavedPlayerSessionFile,
    SessionSnapshot,
    Shard,
    WorldPrefab,
    WorldSessionFile,
    validate,
)

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
LITERALS = runpy.run_path(str(SCRIPTS / 'dst-save-literal.py'))
# Each part owns its source -> project conversion: tiles (map, coordinates, spawn), prefabs (entities), player, systems.
TILE = runpy.run_path(str(SCRIPTS / 'dst-region-tile.py'))
PREFAB = runpy.run_path(str(SCRIPTS / 'dst-region-prefab.py'))
PLAYER = runpy.run_path(str(SCRIPTS / 'dst-region-player.py'))
SYSTEMS = runpy.run_path(str(SCRIPTS / 'dst-region-systems.py'))
CATALOG_COMMAND = ['node', str(SCRIPTS / 'export-save-catalog.mjs')]

ImportReport = dict[str, Any]
SnapshotKey = tuple[Shard, str, str]
ImportJob = tuple[Path, Path, list[int] | None, str | None, WorldPrefab | None, Path | None]
ShardImport = tuple[Path, SaveDocument, SavedPlayerSessionFile | None, ImportReport]
RuntimeSave = tuple[Path, SaveDocument | WorldSessionFile, SavedPlayer | None]


def convert(
    terrain: dict[str, Any], template: SaveDocument, supported: dict[str, int], origin_cell: list[int] | None,
) -> tuple[SaveDocument, ImportReport]:
    """The template's save shell with the converted map and a reset local player at its spawn."""
    world, spawn_position, report = TILE['convert_map'](terrain, supported, origin_cell)
    result = deepcopy(template)
    result['session'].pop('playerFile', None)
    result['world'] = world
    PLAYER['reset_player'](result['players']['local'], world['shardId'], spawn_position)
    return result, report


def save_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'


def write_or_check(path: Path, data: object, check: bool) -> None:
    serialized = save_json(data).encode('utf-8')
    if check:
        if not path.is_file() or path.read_bytes() != serialized:
            raise ValueError(f'{path} differs from the source import')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(serialized)


def validate_runtime(saves: list[RuntimeSave]) -> None:
    """Use the same prefab, item and world validation that loading the save in-game uses."""
    with subprocess.Popen([*CATALOG_COMMAND, '--validate'], stdin=subprocess.PIPE, encoding='utf-8') as child:
        assert child.stdin is not None
        try:
            with child.stdin as stream:
                for output, world, player in saves:
                    payload = [str(output), save_json(world), player]
                    stream.write(json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
        except BrokenPipeError:
            # The validator reports the rejected file and field on stderr before closing the pipe.
            pass
        if child.wait():
            raise ValueError('TypeScript rejected the save import')


def import_shard(
    shard: Path,
    template: SaveDocument,
    supported: dict[str, int],
    catalog: SaveCatalog,
    origin_cell: list[int] | None = None,
    snapshot: str | None = None,
    expected_prefab: WorldPrefab | None = None,
    source_session: Path | None = None,
) -> tuple[SaveDocument, SavedPlayerSessionFile | None, ImportReport]:
    source_shard = shard
    shard = shard.resolve()
    if source_session is None:
        index_path = shard / 'save/shardindex'
        index = LITERALS['returned_table'](index_path.read_text())
        session_id = validate(SESSION_ID, index['session_id'], index_path)
        session = shard / 'save/session' / session_id
        source_path = source_shard / 'save/session' / session_id
    else:
        session_id = validate(SESSION_ID, source_session.name, source_session)
        session = source_session.resolve()
        source_path = source_session
    candidates = sorted(p for p in session.iterdir() if p.is_file() and len(p.name) == 10 and p.name.isdigit())
    if not candidates:
        raise ValueError('No world snapshots found')
    snapshot = validate(SNAPSHOT_ID, snapshot or candidates[-1].name, session)
    source = session / snapshot
    source_text = source.read_text()
    terrain = LITERALS['snapshot_map'](source_text)
    result, report = convert(terrain, template, supported, origin_cell)
    network = LITERALS['snapshot_world'](source_text)
    if not isinstance(network, dict) or set(network) != {'persistdata'}:
        raise ValueError('Expected world_network persistdata')
    result['world']['systems'], result['world']['elapsedSeconds'], systems_report = SYSTEMS['convert_systems'](
        network['persistdata'], terrain['prefab'])
    report['worldSystems'] = systems_report
    source_entities = LITERALS['snapshot_entities'](source_text, PREFAB['source_prefabs']())
    result['world']['entities'], entity_report = PREFAB['convert_entities'](
        terrain, source_entities, report, session_id, catalog)
    report.update(entity_report)
    user, player_source = PLAYER['player_snapshot'](session, snapshot)
    player_session: SavedPlayerSessionFile | None = None
    if user is not None and player_source is not None:
        player = result['players']['local']
        source_player = LITERALS['player_snapshot'](player_source.read_text(encoding='utf-8', errors='surrogateescape'))
        position, player['inventory'], player_report = PLAYER['convert_player'](
            source_player,
            report['translation'], result['world']['map']['generator']['options']['size'],
            f'dst_{session_id}_{user.name}', catalog)
        player['transform']['position'] = position
        migration = (source_player.get('data') or {}).get('migration')
        project_migration = None
        if migration is not None:
            migration = validate(SOURCE_MIGRATION, migration, player_source)
            project_migration = cast(PlayerMigration, {
                key: value for key, value in migration.items() if key in PlayerMigration.__required_keys__
            })
        player_session = {'player': player, 'migration': project_migration}
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
    return result, player_session, report


def cluster_snapshots(cluster: Path) -> list[tuple[SnapshotKey, Path]]:
    """Every world Snapshot, including Session copies stored under another physical shard.

    A Session found under both physical shards keeps only the copy holding its newest Snapshot. The other copy stopped
    being written when the host moved the Session: Cluster_65's Caves directory still holds the cave's creation-day
    0000000002 (worldgen output) and 0000000003 (cycle 0) beside the Master copy's 0000000140 onwards.
    """
    copies: dict[tuple[Shard, str], dict[str, list[Path]]] = {}
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
                copies.setdefault((shard, session.name), {}).setdefault(physical, []).append(source)
    found: dict[SnapshotKey, Path] = {}
    for (shard, session_id), by_physical in copies.items():
        newest = max(sources[-1].name for sources in by_physical.values())
        for sources in by_physical.values():
            if sources[-1].name != newest:
                continue
            for source in sources:
                key = shard, session_id, source.name
                if key in found and source.read_bytes() != found[key].read_bytes():
                    raise ValueError(f'Conflicting source snapshots for {key}')
                found.setdefault(key, source)
    if not found:
        raise ValueError('No forest or cave snapshots found in cluster')
    return sorted(found.items())


def main() -> None:
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
    template = validate(SAVE_DOCUMENT, json.loads(args.template.read_text()), args.template)
    supported = {name: spec['tileId'] for name, spec in json.loads(
        (ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    supported['FAKE_GROUND'] = 200
    # The save loader's item catalog lives in TypeScript; validate player items against the same specs.
    catalog_json = subprocess.run(CATALOG_COMMAND, check=True, capture_output=True, text=True).stdout
    catalog = validate(SAVE_CATALOG, json.loads(catalog_json), CATALOG_COMMAND[1])
    jobs: list[ImportJob] = []
    if args.shard:
        jobs = [(args.shard, args.output, args.origin_cell, args.snapshot, None, None)]
    else:
        for (shard, session_id, snapshot), source in cluster_snapshots(args.cluster):
            prefab: WorldPrefab = 'cave' if shard == 'Caves' else 'forest'
            jobs.append((args.cluster / shard, args.output / shard / 'save/session' / session_id / f'{snapshot}.json',
                         args.origin_cell if prefab == 'cave' else args.forest_origin_cell,
                         snapshot, prefab, source.parent))
    # Convert and validate the entire batch before replacing any output file.
    imports = [(output, *import_shard(shard, template, supported, catalog, origin, snapshot, prefab, source_session))
               for shard, output, origin, snapshot, prefab, source_session in jobs]
    latest: dict[tuple[str, str], ShardImport] = {}
    for entry in imports:
        _, result, _, _ = entry
        key = result['world']['shardId'], result['session']['id']
        if key not in latest or result['snapshot']['id'] > latest[key][1]['snapshot']['id']:
            latest[key] = entry
    active = [result['world']['prefab'] for _, result, player_session, _ in latest.values()
              if player_session is not None and player_session.get('migration') is None]
    if len(active) > 1:
        raise ValueError(f'Player is active in multiple shards: {active}')
    if args.cluster and not active and any(player_session is not None for _, _, player_session, _ in imports):
        raise ValueError('No active player Session found in the cluster')

    manifest: list[SessionSnapshot] = []
    files: list[tuple[Path, object]] = []
    runtime_saves: list[RuntimeSave] = []
    for output, result, player_session, report in imports:
        player_file = result['session'].get('playerFile')
        if player_session is not None and player_file is not None:
            player_path = (args.output if args.cluster else output.parent) / player_file
            files.append((player_path, validate(PLAYER_SESSION_FILE, player_session, player_path)))
        if args.cluster or player_file:
            detached: WorldSessionFile = {**result, 'players': {}}
            world = validate(WORLD_SESSION_FILE, detached, output)
            # Early world-only snapshots still need a local player for the game's deserializer.
            runtime_saves.append((output, world, result['players']['local']))
            files.append((output, world))
        else:
            world_with_player = validate(SAVE_DOCUMENT, result, output)
            runtime_saves.append((output, world_with_player, None))
            files.append((output, world_with_player))
        files.append((output.with_suffix('.import.json'), report))
        if args.cluster:
            manifest.append({'shard': 'Caves' if result['world']['prefab'] == 'cave' else 'Master',
                             'sessionId': output.parent.name, 'snapshotId': result['snapshot']['id'],
                             'worldFile': output.relative_to(args.output).as_posix(),
                             'playerFile': player_file,
                             'migration': player_session.get('migration') if player_session is not None else None})
    if args.cluster:
        for shard, prefab in (('Master', 'forest'), ('Caves', 'cave')):
            matching = [(result, report) for _, result, _, report in latest.values() if result['world']['prefab'] == prefab]
            if len(matching) != 1:
                raise ValueError(f'Expected one {shard} Session, found {len(matching)}')
            result, report = matching[0]
            files.append((args.output / f'{shard}.json', {**result, 'players': {}}))
            files.append((args.output / f'{shard}.import.json', report))
        manifest_path = args.output / 'session.json'
        index = validate(SESSION_MANIFEST,
                         {'activeShard': 'Caves' if active == ['cave'] else 'Master', 'snapshots': manifest},
                         manifest_path)
        files.append((manifest_path, index))

    validate_runtime(runtime_saves)
    for path, data in files:
        write_or_check(path, data, args.check)
    for output, result, _, report in imports:
        print(f'{"Checked" if args.check else "Imported"} {result["world"]["prefab"]}: {report["landCells"]} land cells '
              f'from {len(report["nodes"])} nodes and {sum(len(records) for records in result["world"]["entities"].values())} '
              f'whitelisted entities into {output}')
        ground = report['groundItemCounts']
        print(f'  Static ground art: {len(ground)} prefabs, {sum(item["entities"] for item in ground.values())} entities, '
              f'{sum(item["quantity"] for item in ground.values())} total items')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from None
