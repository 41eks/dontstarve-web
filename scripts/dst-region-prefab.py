#!/usr/bin/env python3
"""DST whitelisted entities and static ground art -> project world entities."""
import math
from pathlib import Path
import runpy

TILE = runpy.run_path(str(Path(__file__).with_name('dst-region-tile.py')))
decode_grid, source_grid_position, project_position = (
    TILE['decode_grid'], TILE['source_grid_position'], TILE['project_position'])
# Source component-state converters, grouped by the components they convert.
GROWABLE, PICKABLE, WORKABLE, STRUCTURE, INVENTORY, CONTAINER, CREATURE = (
    runpy.run_path(str(Path(__file__).with_name(f'dst-region-prefab-{part}.py')))
    for part in ('growable', 'pickable', 'workable', 'structure', 'inventory', 'container', 'creature'))
ITEM = runpy.run_path(str(Path(__file__).with_name('dst-region-item.py')))


# Each whitelist entry owns the source -> project component-state conversion.
# Adding a prefab here requires an actual converter, rather than copying arbitrary Lua data.
ENTITY_WHITELIST = {
    'pigking': STRUCTURE['pigking_components'],
    'researchlab': STRUCTURE['researchlab_components']('researchlab'),
    'researchlab2': STRUCTURE['researchlab_components']('researchlab2'),
    'researchlab3': STRUCTURE['researchlab_components']('researchlab3'),
    'researchlab4': STRUCTURE['researchlab_components']('researchlab4'),
    'statueglommer': WORKABLE['statueglommer_components'],
    'atrium_gate': STRUCTURE['atrium_gate_components'],
    'ruins_statue_mage': WORKABLE['ruins_statue_mage_components'],
    'chessjunk1': WORKABLE['chessjunk_components'],
    'chessjunk2': WORKABLE['chessjunk_components'],
    'chessjunk3': WORKABLE['chessjunk_components'],
    'deciduoustree': GROWABLE['deciduoustree_components'],
    'moon_tree': GROWABLE['moon_tree_components'],
    'moonbutterfly_sapling': GROWABLE['moonbutterfly_sapling_components'],
    'fireflies': INVENTORY['insect_components']('fireflies'),
    'flower': PICKABLE['flower_components'],
    'butterfly': INVENTORY['insect_components']('butterfly'),
    'pighead': WORKABLE['pighead_components'],
    'archive_moon_statue': WORKABLE['archive_moon_statue_components'],
    'cave_exit': STRUCTURE['cave_exit_components'],
    'cave_entrance': STRUCTURE['cave_entrance_components']({'worldmigrator'}),
    'cave_entrance_open': STRUCTURE['cave_entrance_components']({'worldmigrator', 'worldsettingstimer', 'childspawner'}),
    'mushtree_moon': lambda data: GROWABLE['mushtree_components'](data, False),
    'mushtree_medium': lambda data: GROWABLE['mushtree_components'](data, True),
    'mushtree_tall': lambda data: GROWABLE['mushtree_components'](data, True),
    'blue_mushroom': PICKABLE['blue_mushroom_components'],
    'grass': PICKABLE['pickable_plant_components']('grass'),
    'sapling': PICKABLE['pickable_plant_components']('sapling'),
    'cactus': PICKABLE['cactus_components']('cactus'),
    'oasis_cactus': PICKABLE['cactus_components']('oasis_cactus'),
    'evergreen': GROWABLE['evergreen_components'],
    'flower_cave': PICKABLE['flower_cave_components']('flower_cave'),
    'flower_cave_double': PICKABLE['flower_cave_components']('flower_cave_double'),
    'flower_cave_triple': PICKABLE['flower_cave_components']('flower_cave_triple'),
    'lightflier_flower': PICKABLE['lightflier_flower_components'],
    'houndbone': WORKABLE['houndbone_components'],
    'beequeenhivegrown': WORKABLE['beequeenhivegrown_components'],
    'cave_fern': PICKABLE['cave_fern_components']('cave_fern'),
    'cave_fern_withered': PICKABLE['cave_fern_components']('cave_fern_withered'),
    'rock1': WORKABLE['rock_components'],
    'rock2': WORKABLE['rock_components'],
    'cavein_boulder': WORKABLE['cavein_boulder_components'],
    'rock_moon_shell': WORKABLE['rock_components'],
    'rock_flintless': WORKABLE['rock_components'],
    'rock_flintless_med': WORKABLE['rock_components'],
    'rock_flintless_low': WORKABLE['rock_components'],
    'rock_moon': WORKABLE['rock_components'],
    'grotto_pool_big': lambda data: STRUCTURE['grotto_pool_components'](data, True),
    'grotto_pool_small': lambda data: STRUCTURE['grotto_pool_components'](data, False),
    'grotto_moonglass_1': WORKABLE['grotto_glass_components'],
    'grotto_moonglass_3': WORKABLE['grotto_glass_components'],
    'grotto_moonglass_4': WORKABLE['grotto_glass_components'],
    'grotto_waterfall_big': STRUCTURE['grotto_waterfall_components'],
    'grotto_waterfall_small1': WORKABLE['grotto_glass_components'],
    'grotto_waterfall_small2': WORKABLE['grotto_glass_components'],
    'pond': STRUCTURE['pond_components'],
    'lava_pond': STRUCTURE['lava_pond_components'],
    'treasurechest': CONTAINER['treasurechest_components'],
    'beefalo': CREATURE['beefalo_components'],
    'dragonfly': CREATURE['dragonfly_components'],
    'dragonfly_spawner': CREATURE['dragonfly_spawner_components'],
}
# Converters that also receive the record's skin; the chest alone uses the item-slot converter.
RECORD_CONTEXT_PREFABS = {'treasurechest', 'researchlab', 'researchlab2', 'researchlab3', 'researchlab4'}
# Converters that also receive the record's project position and a converter for saved source positions.
POSITION_CONTEXT_PREFABS = {'beefalo', 'dragonfly'}


def source_prefabs():
    """Every source entity group the importer reads from a snapshot."""
    return ENTITY_WHITELIST.keys() | INVENTORY['ground_art_catalog']()[0].keys()


def convert_entities(terrain, source_entities, report, session_id, catalog=None):
    width, height = terrain['width'], terrain['height']
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    translation = report['translation']
    result, counts, sources, identities, imported_ids = {}, {}, [], set(), {}
    ground_art, variants = INVENTORY['ground_art_catalog']()
    converters = ENTITY_WHITELIST | {prefab: None for prefab in sorted(ground_art) if source_entities.get(prefab)}
    ground_counts, container_items = {}, {'skipped': [], 'droppedComponents': []}
    for prefab, convert_components in converters.items():
        static = convert_components is None
        records = source_entities.get(prefab, [])
        imported = []
        for index, record in enumerate(records, 1):
            coordinates = [record.get(axis, 0) for axis in ('x', 'y', 'z')]
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in coordinates):
                raise ValueError(f'Invalid {prefab} position at source index {index}')
            x, y, z = coordinates
            col, row = math.floor(source_grid_position(x, width)), math.floor(source_grid_position(z, height))
            # Import every whitelisted record, including props on void, unassigned nodes or map edges.
            node = nodes[row * width + col] if 0 <= col < width and 0 <= row < height else 0
            if node > len(names) and node not in report.get('unassignedNodeIds', []):
                raise ValueError('Grid references an unknown topology node')
            skinned = record.get('skinname') or record.get('skin_id')
            settling_boulder = prefab == 'cavein_boulder' and abs(y) <= .5
            if (not static and ((y != 0 and not settling_boulder) or (skinned and prefab not in RECORD_CONTEXT_PREFABS))) \
                    or (y < 0 and not settling_boulder) or record.get('puid'):
                raise ValueError(f'Unsupported {prefab} height, skin or platform at source index {index}')
            data = record.get('data') or {}
            if not isinstance(data, dict):
                raise ValueError(f'Expected {prefab} component data at source index {index}')
            source_id = record.get('id')
            if source_id is not None and (type(source_id) is not int or source_id < 0):
                raise ValueError(f'Invalid {prefab} source ID')
            suffix = f'id_{source_id}' if source_id is not None else f'index_{index:06}'
            entity_id = f'dst_{session_id}_{prefab}_{suffix}'
            if entity_id in identities:
                raise ValueError(f'Duplicate imported entity ID: {entity_id}')
            identities.add(entity_id)
            if source_id is not None:
                imported_ids[source_id] = entity_id
            if static:
                components = INVENTORY['static_ground_components'](prefab, record, ground_art, variants)
            else:
                try:
                    if prefab in RECORD_CONTEXT_PREFABS:
                        if prefab == 'treasurechest' and catalog is None:
                            raise ValueError(f'{prefab} contents need the save item catalog')
                        components = convert_components(data, {
                            'skin': record.get('skinname'),
                            'items': lambda items, path, slot_count, entity_id=entity_id, suffix=suffix: ITEM['convert_slots'](
                                items, f'{prefab}.{suffix}.{path}', slot_count, entity_id, catalog, container_items)})
                    elif prefab in POSITION_CONTEXT_PREFABS:
                        components = convert_components(data, {
                            'position': project_position(coordinates, translation),
                            'project': lambda source: project_position(source, translation)})
                    else:
                        components = convert_components(data)
                except ValueError:
                    # Early world snapshots can omit a prefab's entire saved component table.
                    # Its Lua constructor/OnLoad then supplies the initial state.
                    if record.get('data') is not None:
                        raise
                    components = {}
            if 'stack' in components:
                components['stack']['entityId'] = entity_id
            imported.append({'id': entity_id,
                             'transform': {'position': project_position([x, 0 if settling_boulder else y, z], translation),
                                           'rotationY': 0},
                             'components': components})
            sources.append({'id': entity_id, 'prefab': prefab, 'sourceIndex': index,
                            **({'sourceId': source_id} if source_id is not None else {}),
                            'sourcePosition': coordinates, 'sourceNode': names[node - 1] if 0 < node <= len(names) else None})
        if imported:
            target_prefab = 'ground_item' if static or prefab in ('fireflies', 'butterfly') else prefab
            result.setdefault(target_prefab, []).extend(imported)
        counts[prefab] = {'source': len(records), 'imported': len(imported)}
        if static:
            ground_counts[prefab] = {'entities': len(records), 'quantity': sum(e['components']['stack']['count'] for e in imported),
                                     'sourceComponents': sorted({key for record in records for key in (record.get('data') or {})})}
    STRUCTURE['link_grotto_pools'](result, imported_ids)
    PICKABLE['link_lightflier_flowers'](result, imported_ids)
    for spawner in result.get('dragonfly_spawner', []):
        outside = spawner['components']['dragonflySpawner']['childspawner']['childrenoutside']
        spawner['components']['dragonflySpawner']['childspawner']['childrenoutside'] = [imported_ids[source_id] for source_id in outside]
    return result, {'entityWhitelist': list(converters), 'entityCounts': counts, 'entitySources': sources,
                    'groundItemCounts': ground_counts, 'containerItems': container_items,
                    'groundItemScope': 'Ground art via the existing ground_item path: identity, position, quantity, skin and visual variants. Existing prefab behavior is reused; art-only IDs add no gameplay components.'}
