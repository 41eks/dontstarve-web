#!/usr/bin/env python3
"""DST imported entities and static ground art -> project world entities."""
from copy import deepcopy
import math
from pathlib import Path
import runpy

TILE = runpy.run_path(str(Path(__file__).with_name('dst-region-tile.py')))
decode_grid, source_grid_position, project_position = (
    TILE['decode_grid'], TILE['source_grid_position'], TILE['project_position'])
COMPONENTS = runpy.run_path(str(Path(__file__).with_name('dst-region-components.py')))
ENTITIES = runpy.run_path(str(Path(__file__).with_name('dst-region-entities.py')))['ENTITIES']
GROUND_ART = runpy.run_path(str(Path(__file__).with_name('dst-region-ground-art.py')))
ITEM = runpy.run_path(str(Path(__file__).with_name('dst-region-item.py')))

# Components any entity may save that no imported prefab ports: validated, then dropped. An entity that ports one lists
# its own rule instead.
UNPORTED_COMPONENTS = {
    # lunarhailbuildup.lua OnSave (MakeSnowCovered's buildup from lunar hail).
    'lunarhailbuildup': COMPONENTS['lunar_hail_buildup'](),
}


def source_prefabs():
    """Every source entity group the importer reads from a snapshot."""
    return ENTITIES.keys() | GROUND_ART['ground_art_catalog']()[0].keys()


def check_skin(prefab, spec, record):
    """GetSaveRecord's skinname (and skin_id) only for a prefab whose skins the project has."""
    skins = spec.skins(prefab) if callable(spec.skins) else spec.skins
    skin = record.get('skinname')
    if (skins is None and (skin or record.get('skin_id'))) or (skins is not None and skin is not None and skin not in skins):
        raise ValueError(f'Unsupported {prefab} skin: {skin}')


def convert_saved(prefab, data, hooks):
    """One source record's saved table -> its project components and the links to resolve once every record is imported;
    None when the project cannot represent the saved state."""
    spec = ENTITIES[prefab]
    if not data and spec.empty:
        return {}, []
    if spec.needs_items and hooks.get('items') is None:
        raise ValueError(f'{prefab} contents need the save item catalog')
    rules = {**spec.saved, **{key: rule for key, rule in UNPORTED_COMPONENTS.items() if key not in spec.saved}}
    if set(data) - rules.keys():
        raise ValueError(f'Unsupported {prefab} save state: {sorted(set(data) - rules.keys())}')
    if set(spec.required) - set(data):
        raise ValueError(f'Unsupported {prefab} save state: missing {sorted(set(spec.required) - set(data))}')
    context = COMPONENTS['Context'](prefab, data, {**spec.defaults, **data}, hooks)
    context.out = deepcopy(spec.base)
    for key, rule in rules.items():
        if context.data.get(key) is not None:
            rule(context.data[key], context)
            if context.skip:
                return None, []
    for check in spec.onload:
        check(context)
    out = context.out
    if spec.order:
        out = {**{key: out[key] for key in spec.order if key in out},
               **{key: value for key, value in out.items() if key not in spec.order}}
    return out, context.links


def convert_components(prefab, data, skin=None, hooks=None):
    """A prefab's components from a saved table alone, as convert_entities converts one record (without links)."""
    check_skin(prefab, ENTITIES[prefab], {'skinname': skin})
    components, _ = convert_saved(prefab, data, {'project': lambda position: position, **(hooks or {})})
    return components


def convert_entities(terrain, source_entities, report, session_id, catalog=None):
    width, height = terrain['width'], terrain['height']
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    translation = report['translation']
    result, counts, sources, identities, imported_ids, links = {}, {}, [], set(), {}, []
    ground_art, variants = GROUND_ART['ground_art_catalog']()
    converters = {**ENTITIES, **{prefab: None for prefab in sorted(ground_art) if source_entities.get(prefab)}}
    ground_counts, container_items, skipped = {}, {'skipped': [], 'droppedComponents': []}, []
    for prefab, spec in converters.items():
        static = spec is None
        records = source_entities.get(prefab, [])
        imported = []
        for index, record in enumerate(records, 1):
            coordinates = [record.get(axis, 0) for axis in ('x', 'y', 'z')]
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in coordinates):
                raise ValueError(f'Invalid {prefab} position at source index {index}')
            x, y, z = coordinates
            col, row = math.floor(source_grid_position(x, width)), math.floor(source_grid_position(z, height))
            # Import every record, including props on void, unassigned nodes or map edges.
            node = nodes[row * width + col] if 0 <= col < width and 0 <= row < height else 0
            if node > len(names) and node not in report.get('unassignedNodeIds', []):
                raise ValueError('Grid references an unknown topology node')
            # Ground art and raised items keep their height; a boulder saved while settling lands.
            height_rule = 'raised' if static else spec.height
            lands = height_rule == 'settles' and abs(y) <= .5
            if (y != 0 and height_rule != 'raised' and not lands) or (y < 0 and not lands) or record.get('puid'):
                raise ValueError(f'Unsupported {prefab} height or platform at source index {index}')
            if not static:
                check_skin(prefab, spec, record)
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
            record_links = []
            if static:
                components = GROUND_ART['static_ground_components'](prefab, record, ground_art, variants)
            else:
                hooks = {'project': lambda source: project_position(source, translation)}
                if catalog is not None:
                    hooks['item'] = lambda item, path, entity_id=entity_id, suffix=suffix: ITEM['convert_item'](
                        item, f'{prefab}.{suffix}.{path}', f'{entity_id}_{path}', catalog, container_items)
                    hooks['items'] = lambda items, path, slot_count, entity_id=entity_id, suffix=suffix: ITEM['convert_slots'](
                        items, f'{prefab}.{suffix}.{path}', slot_count, entity_id, catalog, container_items)
                try:
                    components, record_links = convert_saved(prefab, data, hooks)
                except ValueError:
                    # Early world snapshots can omit a prefab's entire saved component table.
                    # Its Lua constructor/OnLoad then supplies the initial state.
                    if record.get('data') is not None:
                        raise
                    components, record_links = {}, []
            if components is None:
                # The project cannot represent the saved state: the record is not imported.
                skipped.append({'prefab': prefab, 'sourceIndex': index,
                                **({'sourceId': source_id} if source_id is not None else {})})
                continue
            identities.add(entity_id)
            if source_id is not None:
                imported_ids[source_id] = entity_id
            links += record_links
            # The project's EntitySaveRecord (packages/prefab/src/saveRecord.ts): `components` is its EntityPersistData,
            # and the skin is GetSaveRecord's skinname, for static art and the prefabs whose skins the project has.
            skinname = record.get('skinname') if static or spec.skins is not None else None
            imported.append({'id': entity_id,
                             'transform': {'position': project_position([x, 0 if lands else y, z], translation),
                                           'rotationY': 0},
                             'components': components, **({'skinname': skinname} if skinname is not None else {})})
            sources.append({'id': entity_id, 'prefab': prefab, 'sourceIndex': index,
                            **({'sourceId': source_id} if source_id is not None else {}),
                            'sourcePosition': coordinates, 'sourceNode': names[node - 1] if 0 < node <= len(names) else None})
        if imported:
            # Items are saved under their own prefab, as Ents saves them; a few source groups under another project prefab.
            result.setdefault(prefab if static or spec.save_as is None else spec.save_as, []).extend(imported)
        counts[prefab] = {'source': len(records), 'imported': len(imported)}
        if static:
            ground_counts[prefab] = {'entities': len(records), 'quantity': sum(e['components'].get('stackable', {}).get('stack', 1) for e in imported),
                                     'sourceComponents': sorted({key for record in records for key in (record.get('data') or {})})}
    # Saved source GUIDs (children, linked props) become project IDs once every record is imported.
    for link in links:
        link(imported_ids)
    return result, {'entityWhitelist': list(converters), 'entityCounts': counts, 'entitySources': sources,
                    'groundItemCounts': ground_counts, 'containerItems': container_items, 'skippedEntities': skipped,
                    'groundItemScope': 'Ground art as item prefabs saved under their own IDs: identity, position, quantity, skin and visual variants. Existing prefab behavior is reused; art-only IDs add no gameplay components.'}
