import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import runpy
import struct
import unittest

IMPORTER = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/import-dst-region.py'))
TILE, PREFAB, PLAYER = IMPORTER['TILE'], IMPORTER['PREFAB'], IMPORTER['PLAYER']


class RegionImportTest(unittest.TestCase):
    def test_loose_ground_art_preserves_visuals_quantity_skin_and_height_without_inventory_components(self):
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'width': 3, 'height': 3, 'topology': {'ids': ['Forest']}, 'nodeidtilemap': encode([1] * 9)}
        source = {
            'rocks': [{'id': 1, 'x': 2, 'y': 1, 'z': -3, 'data': {'anim': 'f2', 'stackable': {'stack': 8}}}],
            'singingshell_octave3': [{'id': 2, 'data': {'variation': 3, 'cyclable': {'step': 11}}}],
            'goldenaxe': [{'id': 3, 'skinname': 'goldenaxe_invisible', 'skin_id': 42,
                           'data': {'finiteuses': {'uses': 72.5}}}],
            'bundle': [{'data': {'unwrappable': {'items': [{'prefab': 'goldnugget'}, {'prefab': 'charcoal'}]}}}],
            'blueprint': [{'data': {'is_rare': True, 'recipetouse': 'dock_kit'}}],
            'rabbit': [{'id': 9}],
        }
        entities, provenance = PREFAB['convert_entities'](terrain, source, {'translation': [12, 0, 24]}, 'ART')
        records = {e['components']['stack']['itemId']: e for e in entities['ground_item']}
        self.assertEqual(records['rocks'], {'id': 'dst_ART_rocks_id_1',
                         'transform': {'position': [18, 3, -15], 'rotationY': 0},
                         'components': {'stack': {'entityId': 'dst_ART_rocks_id_1', 'itemId': 'rocks', 'count': 8, 'variant': 'f2'}}})
        self.assertEqual(records['goldenaxe']['components']['stack'],
                         {'entityId': 'dst_ART_goldenaxe_id_3', 'itemId': 'goldenaxe', 'count': 1, 'skinId': 'goldenaxe_invisible'})
        self.assertEqual(records['bundle']['components']['stack']['variant'], 'medium')
        self.assertEqual(records['blueprint']['components']['stack']['variant'], 'rare')
        self.assertEqual(records['singingshell_octave3']['components']['stack']['variant'], '3')
        self.assertNotIn('rabbit', provenance['groundItemCounts'])
        self.assertEqual(provenance['groundItemCounts']['rocks']['quantity'], 8)
        self.assertEqual(set(entities), {'ground_item'})
        source['rocks'][0]['data']['anim'] = 'f99'
        with self.assertRaisesRegex(ValueError, 'ground variant'):
            PREFAB['convert_entities'](terrain, source, {'translation': [12, 0, 24]}, 'ART')

    def test_full_map_remaps_ids_and_preserves_holes_and_unassigned_cells(self):
        width, height = 7, 5
        tiles, nodes = [1] * (width * height), [0] * (width * height)
        for z in range(1, 4):
            for x in range(1, 4):
                tiles[z * width + x], nodes[z * width + x] = 14, 1
        tiles[2 * width + 4], nodes[2 * width + 4] = 200, 2
        tiles[2 * width + 5], nodes[2 * width + 5] = 45, 0
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'prefab': 'cave', 'width': width, 'height': height,
                   'tiles': encode(tiles), 'nodeidtilemap': encode(nodes),
                   'topology': {'ids': ['BlueForest:0:Forest', 'ArchiveMaze:0:Room']},
                   'world_tile_map': {'IMPASSABLE': 1, 'FUNGUS': 14, 'ARCHIVE': 45, 'FAKE_GROUND': 200}}
        template = {'players': {'local': {'ghost': True, 'inventory': {'old': 'discard'}}}}
        result, report = IMPORTER['convert'](terrain, template,
                                             {'FUNGUS': 256, 'ARCHIVE': 45, 'FAKE_GROUND': 200})
        self.assertEqual(result['world']['prefab'], 'cave')
        self.assertEqual(result['world']['map']['defaultTileId'], 1)
        self.assertEqual(report['landCells'], 10)
        self.assertEqual(report['tileCounts'], {'ARCHIVE': 1, 'FAKE_GROUND': 1, 'FUNGUS': 9})
        cells = {(t['col'], t['row']): t['tileId'] for t in result['world']['map']['tiles']}
        self.assertEqual(cells, {(x - 3, 1 - z): 256 for x in range(1, 4) for z in range(1, 4)} | {(1, -1): 200, (2, -1): 45})
        self.assertEqual(result['players']['local']['transform']['position'], [-6, 0, -6])
        self.assertEqual(report['scope'], 'full-map')
        self.assertEqual(report['nodes'], terrain['topology']['ids'])
        self.assertEqual(result['world']['map']['generator']['options']['size'], 144)
        self.assertNotIn('ghost', result['players']['local'])
        self.assertEqual(result['world']['entities'], {})
        self.assertIn('ghost', template['players']['local'])
        extended, _ = IMPORTER['convert'](terrain, template,
                                         {'FUNGUS': 256, 'ARCHIVE': 45, 'FAKE_GROUND': 200}, [5, 2])
        self.assertEqual(extended['world']['map']['tiles'],
                         [{**tile, 'col': tile['col'] - 2} for tile in result['world']['map']['tiles']])
        with self.assertRaisesRegex(ValueError, 'Unsupported terrain'):
            IMPORTER['convert'](terrain, template, {})

    def test_cluster_imports_both_active_sessions_and_checks_without_writing(self):
        script = Path(__file__).resolve().parents[1] / 'scripts/import-dst-region.py'
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()

        def literal(value):
            if isinstance(value, dict):
                return '{' + ','.join(f'[{json.dumps(k)}]={literal(v)}' for k, v in value.items()) + '}'
            if isinstance(value, list):
                return '{' + ','.join(map(literal, value)) + '}'
            return json.dumps(value)

        with tempfile.TemporaryDirectory() as directory:
            cluster = Path(directory) / 'source'
            template = Path(directory) / 'template.json'
            template.write_text(json.dumps({'session': {}, 'snapshot': {}, 'players': {'local': {}}}))
            for name, prefab, session_id, snapshot in [('Master', 'forest', 'FOREST', '0000000003'),
                                                       ('Caves', 'cave', 'CAVE', '0000000005')]:
                shard = cluster / name
                session = shard / 'save/session' / session_id
                session.mkdir(parents=True)
                (shard / 'save/shardindex').write_text(f'return {{session_id="{session_id}"}}')
                tiles = [201 if prefab == 'forest' else 1] * 49
                for row in range(1, 4):
                    for col in range(1, 4):
                        tiles[row * 7 + col] = 8
                if prefab == 'forest':
                    tiles[5 * 7 + 5] = 300  # OCEAN_ICE is land despite its name.
                terrain = {'prefab': prefab, 'width': 7, 'height': 7, 'tiles': encode(tiles),
                           'nodeidtilemap': encode([1] * 49), 'topology': {'ids': ['Room']},
                           'world_tile_map': {'IMPASSABLE': 1, 'GRASS': 8, 'OCEAN_SWELL': 201, 'OCEAN_ICE': 300}}
                source = 'tablefunctions["map_fn"] = function() return ' + literal(terrain) + '\nend\n'
                (session / '0000000001').write_text(source)
                (session / snapshot).write_text(source + 'tablefunctions["ents_grass_fn"] = function() return {{id=7,x=0,z=0}} end')
                player = {'prefab': 'wortox', 'x': 0 if prefab == 'forest' else 2,
                          'z': 0 if prefab == 'forest' else -2,
                          'data': {'migration': {'worldid': '1', 'portalid': 4, 'sessionid': session_id}}
                          if prefab == 'forest' else {}}
                user = session / 'USER'
                user.mkdir()
                (user / snapshot).write_text('return ' + literal(player))
            # The newer cave snapshot is kept in Master even though Caves/shardindex names the same Session.
            newer_cave = cluster / 'Master/save/session/CAVE'
            (newer_cave / 'USER').mkdir(parents=True)
            (newer_cave / '0000000006').write_text(source)
            (newer_cave / 'USER/0000000006').write_text('return ' + literal({
                'prefab': 'wortox', 'x': 4, 'z': -4, 'data': {}}))
            output = Path(directory) / 'converted'
            command = [sys.executable, str(script), '--cluster', str(cluster), '--output', str(output), '--template', str(template)]
            subprocess.run(command, check=True, capture_output=True)
            forest = json.loads((output / 'Master.json').read_text())
            caves = json.loads((output / 'Caves.json').read_text())
            self.assertEqual((forest['world']['prefab'], forest['world']['shardId'], forest['snapshot']['id']),
                             ('forest', 'master', '0000000003'))
            self.assertEqual((caves['world']['prefab'], caves['snapshot']['id']), ('cave', '0000000006'))
            self.assertEqual(forest['players'], {})
            self.assertEqual(caves['players'], {})
            forest_player = json.loads((output / forest['session']['playerFile']).read_text())
            cave_player = json.loads((output / caves['session']['playerFile']).read_text())
            self.assertEqual(forest_player['migration'], {'worldid': '1', 'portalid': 4, 'sessionid': 'FOREST'})
            self.assertIsNone(cave_player['migration'])
            self.assertEqual(cave_player['player']['shardId'], 'caves')
            index = json.loads((output / 'session.json').read_text())
            self.assertEqual(index['activeShard'], 'Caves')
            self.assertEqual(len(index['snapshots']), 5)
            self.assertEqual(index['snapshots'][-1]['worldFile'], 'Master/save/session/FOREST/0000000003.json')
            self.assertIn('Master/save/session/CAVE/0000000006',
                          json.loads((output / 'Caves.import.json').read_text())['source'])
            self.assertNotEqual(forest['session']['id'], caves['session']['id'])
            report = json.loads((output / 'Master.import.json').read_text())
            self.assertEqual(report['landCells'], 10)
            self.assertEqual(report['savedCells'], 49)
            position = forest_player['player']['transform']['position']
            self.assertEqual(position, TILE['project_position']([0, 0, 0], report['translation']))
            cave_report = json.loads((output / 'Caves.import.json').read_text())
            self.assertEqual(cave_player['player']['transform']['position'],
                             TILE['project_position']([4, 0, -4], cave_report['translation']))
            self.assertIn('dst_FOREST_grass_id_7', forest['world']['entities']['grass'][0]['id'])
            before = {str(path.relative_to(output)): path.read_bytes() for path in output.rglob('*') if path.is_file()}
            subprocess.run([*command, '--check'], check=True, capture_output=True)
            self.assertEqual(before, {str(path.relative_to(output)): path.read_bytes()
                                      for path in output.rglob('*') if path.is_file()})
            (output / 'Master.json').write_text('{}')
            self.assertNotEqual(subprocess.run([*command, '--check'], capture_output=True).returncode, 0)
            self.assertEqual((output / 'Master.json').read_text(), '{}')
            # Failure in the second shard must not replace the first shard's existing save.
            (cluster / 'Caves/save/session/CAVE/0000000005').write_text('invalid snapshot')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((output / 'Master.json').read_text(), '{}')

    def test_rejects_bad_grid_and_lua_code_without_execution(self):
        for raw in [b'garbage', b'VRSN\0\x02\0\0\0\x01\0', b'VRSN\0\x01\0\0\0']:
            with self.assertRaises(ValueError):
                TILE['decode_grid'](base64.b64encode(raw).decode(), 1, 1)
        reader = IMPORTER['LITERALS']['returned_table']
        self.assertEqual(reader('KLEI     1 return {session_id="ABC", nested={true, false, 2.5}}'),
                         {'session_id': 'ABC', 'nested': [True, False, 2.5]})
        with self.assertRaises(ValueError):
            reader('return {session_id=os.execute("touch /tmp/should-not-execute")}')

    def test_surface_entities_preserve_flower_origin_tree_timers_and_insect_stack_identity(self):
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'width': 3, 'height': 3, 'topology': {'ids': ['Forest']}, 'nodeidtilemap': encode([1] * 9)}
        report = {'translation': [12, 0, 24]}
        tree = {'monster': False, 'growable': {'stage': 2, 'time': 512, 'sleeptime': 68},
                'plantregrowth': {'regrowthtime': 100}, 'leaf_state': 'colorful',
                'target_leaf_state': 'barren', 'build': 'red', 'leaveschangetime': 30}
        stump = {'monster': False, 'stump': True, 'growable': {'stage': 1, 'sleeptime': 4805}, 'leaf_state': 'normal',
                 'timer': {'timers': {'decay': {'timeleft': 100, 'initial_time': 200, 'paused': True}}}}
        source = {
            'pigking': [{'x': 0, 'z': 0}],
            'deciduoustree': [{'id': 1, 'data': tree}, {'id': 2, 'data': stump}],
            'moon_tree': [{'id': 6, 'data': {'size': 'normal', 'growable': tree['growable']}},
                          {'id': 7, 'data': {'size': 'short', 'stump': True, 'timer': stump['timer']}}],
            'moonbutterfly_sapling': [{'id': 8, 'data': {'timer': {'timers': {
                'grow': {'timeleft': 80, 'initial_time': 225, 'paused': False}}}}}],
            'flower': [{'id': 3, 'data': {'anim': 'rose', 'pickable': {'caninteractwith': True}}},
                       {'id': 4, 'data': {'anim': 'f9', 'planted': True}}],
            'fireflies': [{'data': {'stackable': {'stack': 8}}}],
            'butterfly': [{'id': 5, 'data': {'health': {'health': 1}, 'stackable': {'stack': 2},
                                             'perishable': {'time': 720, 'paused': True}}}],
        }
        entities, provenance = PREFAB['convert_entities'](terrain, source, report, 'SURFACE')
        self.assertEqual(entities['pigking'][0]['components'], {})
        self.assertEqual(entities['pigking'][0]['transform']['position'], [12, 0, -24])
        self.assertEqual(entities['deciduoustree'][0]['components'], {
            'growable': tree['growable'], 'deciduoustree': {'build': 'red', 'leaf_state': 'colorful',
                'target_leaf_state': 'barren', 'leaveschangetime': 30}})
        self.assertEqual(entities['deciduoustree'][1]['components'], {
            'growable': stump['growable'], 'deciduoustree': {'stump': True, 'leaf_state': 'normal'},
            'deciduousTimer': stump['timer']})
        self.assertEqual(entities['moon_tree'][0]['components'], {
            'moonTree': {'size': 'normal'}, 'growable': tree['growable']})
        self.assertEqual(entities['moon_tree'][1]['components'], {
            'moonTree': {'size': 'short', 'stump': True}, 'moonTreeTimer': stump['timer']})
        self.assertEqual(entities['moonbutterfly_sapling'][0]['components'], {
            'saplingTimer': source['moonbutterfly_sapling'][0]['data']['timer']})
        self.assertEqual(provenance['entityCounts']['moon_tree'], {'source': 2, 'imported': 2})
        self.assertEqual([record['components']['flower'] for record in entities['flower']],
                         [{'animation': 'rose'}, {'animation': 'f9', 'planted': True}])
        insects = entities['ground_item']
        self.assertEqual([record['components']['stack']['itemId'] for record in insects], ['fireflies', 'butterfly'])
        self.assertEqual([record['components']['stack']['count'] for record in insects], [8, 2])
        self.assertEqual(insects[1]['components']['stack']['freshnessPercent'], .5)
        self.assertTrue(all(record['components']['stack']['entityId'] == record['id'] for record in insects))
        self.assertEqual(provenance['entityCounts']['fireflies'], {'source': 1, 'imported': 1})
        self.assertEqual(provenance['entityCounts']['butterfly'], {'source': 1, 'imported': 1})
        self.assertEqual(PREFAB['convert_entities'](terrain, source, report, 'SURFACE')[0], entities)
        self.assertNotIn('growable', PREFAB['GROWABLE']['deciduoustree_components']({'burnt': True, 'leaf_state': 'normal'}))
        for prefab, data in [('moon_tree', {'size': 'short', 'growable': {'stage': 2}}),
                             ('moonbutterfly_sapling', {'timer': {'timers': {}}}),
                             ('deciduoustree', {**tree, 'monster': True}),
                             ('deciduoustree', {**tree, 'growable': {'stage': 4}}),
                             ('flower', {'anim': 'f1', 'pickable': {'picked': True}}),
                             ('fireflies', {'stackable': {'stack': 41}}),
                             ('butterfly', {'health': {'health': 0}})]:
            with self.subTest(prefab=prefab, data=data), self.assertRaises(ValueError):
                PREFAB['ENTITY_WHITELIST'][prefab](data)

    def test_plant_import_preserves_wither_check_and_protection(self):
        convert = PREFAB['ENTITY_WHITELIST']['grass']
        self.assertEqual(convert({'pickable': {'caninteractwith': True},
                                  'witherable': {'task_time_remaining': 25.566665861756}}),
                         {'witherable': {'taskSeconds': 25.566665861756}})
        self.assertEqual(convert({'witherable': {'protect_time_remaining': 30}}),
                         {'witherable': {'protectSeconds': 30}})
        with self.assertRaisesRegex(ValueError, 'Unsupported grass witherable state'):
            convert({'witherable': {'protect_time_remaining': -1}})

    def test_rock_import_preserves_variation_and_rejects_unsupported_source_state(self):
        self.assertEqual(PREFAB['ENTITY_WHITELIST']['rock_moon']({}), {})
        self.assertEqual(PREFAB['ENTITY_WHITELIST']['rock1']({'workable': {}}), {})
        convert = PREFAB['ENTITY_WHITELIST']['cavein_boulder']
        self.assertEqual(convert({'variation': 7, 'submersible': {'force_no_repositioning': False}}),
                         {'caveinBoulder': {'variation': 7}})
        self.assertEqual(convert({'raised': True}), {'caveinBoulder': {'variation': 1, 'raised': True}})
        for data in ({'variation': 9}, {'variation': True}, {'formed': False}, {'fallx': 1, 'fallz': 2}):
            with self.assertRaises(ValueError):
                convert(data)
        with self.assertRaises(ValueError):
            PREFAB['WORKABLE']['rock_components']({'workable': {'workleft': 2}})

    def test_research_labs_import_skin_burnt_state_and_identity(self):
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'width': 3, 'height': 3, 'topology': {'ids': ['Forest']}, 'nodeidtilemap': encode([1] * 9)}
        source = {
            'researchlab2': [{'x': 4, 'z': -8, 'data': {'workable': {}}}],
            'researchlab3': [{'id': 19, 'skinname': 'researchlab3_nature', 'skin_id': 88267382,
                              'data': {'burnt': True}}],
        }
        entities, report = PREFAB['convert_entities'](terrain, source, {'translation': [12, 0, -24]}, 'LAB')
        self.assertEqual(entities['researchlab2'], [
            {'id': 'dst_LAB_researchlab2_index_000001',
             'transform': {'position': [24, 0, 48], 'rotationY': 0},
             'components': {'building': {'state': 'idle'}}},
        ])
        self.assertEqual(entities['researchlab3'][0]['id'], 'dst_LAB_researchlab3_id_19')
        self.assertEqual(entities['researchlab3'][0]['components'],
                         {'building': {'state': 'idle', 'skinId': 'researchlab3_nature', 'burnt': True}})
        self.assertEqual(report['entityCounts']['researchlab3'], {'source': 1, 'imported': 1})
        self.assertTrue({'researchlab', 'researchlab2', 'researchlab3', 'researchlab4'} <= set(report['entityWhitelist']))
        for bad in ({'burnt': False}, {'workable': {'workleft': 2}}, {'unknown': True}):
            with self.assertRaises(ValueError):
                PREFAB['ENTITY_WHITELIST']['researchlab2'](bad, {'skin': None})
        with self.assertRaisesRegex(ValueError, 'Unsupported researchlab3 skin'):
            PREFAB['ENTITY_WHITELIST']['researchlab3']({}, {'skin': 'researchlab2_pod'})

    def test_moonbase_imports_repair_state_and_held_staff_charge_timers(self):
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'width': 3, 'height': 3, 'topology': {'ids': ['Forest']}, 'nodeidtilemap': encode([1] * 9)}
        catalog = {'items': {'yellowstaff': {'maxStack': 1, 'maxUses': 20},
                             'opalstaff': {'maxStack': 1, 'maxUses': 50}},
                   'skins': {'starstaff_crystal': 'yellowstaff'}}
        timer = {'timers': {'mooncharge': {'timeleft': 25, 'paused': False, 'initial_time': 49.9},
                            'mooncharge3': {'timeleft': 3, 'paused': True, 'initial_time': 18.7}}}
        source = {'moonbase': [
            {'id': 8, 'x': -20, 'z': 172, 'data': {
                'workable': {'maxwork': 6, 'workleft': 6}, 'pickable': {'paused': True, 'picked': True}}},
            {'id': 9, 'data': {'workable': {'maxwork': 6, 'workleft': 2},
                              'pickable': {'caninteractwith': True, 'paused': True},
                              'staff': {'prefab': 'yellowstaff', 'skinname': 'starstaff_crystal',
                                        'data': {'finiteuses': {'uses': 7}}}, 'timer': timer}},
            {'data': {'pickable': {'caninteractwith': True}, 'staffname': 'opalstaff', 'staffuse': 12}},
        ]}
        entities, report = PREFAB['convert_entities'](terrain, source, {'translation': [12, 0, -24]}, 'MOON', catalog)
        fixed, charging, legacy = entities['moonbase']
        self.assertEqual(fixed, {'id': 'dst_MOON_moonbase_id_8',
                                'transform': {'position': [-48, 0, -492], 'rotationY': 0},
                                'components': {'building': {'state': 'idle'},
                                               'workable': {'maxwork': 6, 'workleft': 6}}})
        self.assertEqual(charging['components'], {
            'building': {'state': 'idle'}, 'workable': {'maxwork': 6, 'workleft': 2},
            'moonbase': {'staff': {'entityId': 'dst_MOON_moonbase_id_9_staff', 'itemId': 'yellowstaff',
                                   'count': 1, 'skinId': 'starstaff_crystal', 'remainingUses': 7}, 'timer': timer}})
        self.assertEqual(legacy['components']['moonbase']['staff']['remainingUses'], 12)
        self.assertEqual(report['entityCounts']['moonbase'], {'source': 3, 'imported': 3})
        self.assertIn('moonbase', PREFAB['source_prefabs']())
        convert = PREFAB['ENTITY_WHITELIST']['moonbase']
        for bad in ({'workable': {'maxwork': 6, 'workleft': 7}},
                    {'timer': timer}, {'pickable': {'caninteractwith': True}, 'staffname': 'firestaff'}):
            with self.assertRaises(ValueError):
                convert(bad, {'skin': None})

    def test_entity_whitelist_imports_all_nodes_and_preserves_source_state_and_identity(self):
        nodes = [0] * 48
        nodes[3 * 8 + 3] = nodes[3 * 8 + 4] = 1
        terrain = {'width': 8, 'height': 6, 'topology': {'ids': ['BlueForest:0:Room']},
                   'nodeidtilemap': base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack('<48H', *nodes)).decode()}
        # All records are imported, including unassigned nodes, void and coordinates outside the grid.
        report = {'nodes': ['BlueForest:0:Room'], 'translation': [12, 0, -24]}
        source = '''
tablefunctions["ents_pighead_fn"] = function()
return {{x=1000,z=0},{x=-4,z=0},{id=9,x=0,z=0,data={burnt=true}}}
end
tablefunctions["ents_archive_moon_statue_fn"] = function()
return {{id=42,x=0,z=0,data={anim=4}},{id=43,x=-16,z=-12,data={anim=2}}}
end
tablefunctions["ents_mushtree_medium_fn"] = function()
return {{id=5,x=0,z=0,data={growable={usetimemultiplier=false,time=0,stage=3,sleeptime=4836},plantregrowth={regrowthtime=1.5},treestate="bloom"}}}
end
tablefunctions["ents_mushtree_moon_fn"] = function()
return {{id=6,x=0,z=0,data={plantregrowth={regrowthtime=294.1}}},{id=8,x=0,z=0,data={stump=true,plantregrowth={}}}}
end
tablefunctions["ents_mushtree_tall_fn"] = function()
return {{id=11,x=0,z=0,data={growable={usetimemultiplier=false,time=0,stage=2,sleeptime=4836},plantregrowth={regrowthtime=514.0},treestate="normal"}}}
end
tablefunctions["ents_blue_mushroom_fn"] = function()
return {{x=0,z=0},{id=12,x=0,z=0,data={rain=14}}}
end
tablefunctions["ents_cave_exit_fn"] = function()
return {{id=7,x=0,z=0,data={worldmigrator={id=7,auto=true,linkedWorld="1",receivedPortal=7}}}}
end
tablefunctions["ents_grotto_pool_big_fn"] = function()
return {{id=20,x=0,z=0,data={children_ids={21,22,99},children_indexes={1,2,3}}}}
end
tablefunctions["ents_grotto_waterfall_big_fn"] = function()
return {{id=21,x=0,z=0}}
end
tablefunctions["ents_grotto_moonglass_1_fn"] = function()
return {{id=22,x=0,z=0,data={workable={maxwork=-1,workleft=0}}}}
end
tablefunctions["ents_grotto_pool_small_fn"] = function()
return {{id=23,x=0,z=0,data={wf_id=24}}}
end
tablefunctions["ents_grotto_waterfall_small2_fn"] = function()
return {{id=24,x=0,z=0,data={workable={maxwork=-1,workleft=3}}}}
end
tablefunctions["ents_mermhead_fn"] = function()
return os.execute("not-whitelisted")
end
'''
        groups = IMPORTER['LITERALS']['snapshot_entities'](source, PREFAB['ENTITY_WHITELIST'])
        entities, provenance = PREFAB['convert_entities'](terrain, groups, report, 'SESSION')
        self.assertEqual(set(entities), {'pighead', 'archive_moon_statue', 'cave_exit', 'mushtree_medium', 'mushtree_moon', 'mushtree_tall', 'blue_mushroom',
                                    'grotto_pool_big', 'grotto_pool_small', 'grotto_moonglass_1', 'grotto_waterfall_big', 'grotto_waterfall_small2'})
        self.assertEqual(entities['pighead'], [
            {'id': 'dst_SESSION_pighead_index_000001', 'transform': {'position': [3012, 0, 24], 'rotationY': 0},
             'components': {'building': {'state': 'idle'}}},
            {'id': 'dst_SESSION_pighead_index_000002', 'transform': {'position': [0, 0, 24], 'rotationY': 0},
             'components': {'building': {'state': 'idle'}}},
            {'id': 'dst_SESSION_pighead_id_9', 'transform': {'position': [12, 0, 24], 'rotationY': 0},
             'components': {'building': {'state': 'idle', 'burnt': True}}},
        ])
        self.assertEqual(entities['archive_moon_statue'], [
            {'id': 'dst_SESSION_archive_moon_statue_id_42', 'transform': {'position': [12, 0, 24], 'rotationY': 0},
             'components': {'archiveProp': {'anim': 4}}},
            {'id': 'dst_SESSION_archive_moon_statue_id_43', 'transform': {'position': [-36, 0, 60], 'rotationY': 0},
             'components': {'archiveProp': {'anim': 2}}},
        ])
        self.assertEqual(entities['cave_exit'], [
            {'id': 'dst_SESSION_cave_exit_id_7', 'transform': {'position': [12, 0, 24], 'rotationY': 0}, 'components': {}}])
        # Pools keep only the children that were imported, linked by project entity ID; props keep their work left.
        self.assertEqual(entities['grotto_pool_big'][0]['components'], {'grottoPool': {'children': [
            {'index': 1, 'id': 'dst_SESSION_grotto_waterfall_big_id_21'}, {'index': 2, 'id': 'dst_SESSION_grotto_moonglass_1_id_22'}]}})
        self.assertEqual(entities['grotto_pool_small'][0]['components'], {'grottoPool': {'children': [
            {'index': 1, 'id': 'dst_SESSION_grotto_waterfall_small2_id_24'}]}})
        self.assertEqual(entities['grotto_moonglass_1'][0]['components'], {'grottoGlass': {'workleft': 0}})
        self.assertEqual(entities['grotto_waterfall_small2'][0]['components'], {'grottoGlass': {'workleft': 3}})
        self.assertEqual(entities['grotto_waterfall_big'][0]['components'], {})
        self.assertEqual([e['components'] for e in entities['mushtree_medium']], [
            {'mushtree': {'treestate': 'bloom'}, 'growable': {'stage': 3, 'time': 0, 'sleeptime': 4836}}])
        self.assertEqual([e['components'] for e in entities['mushtree_tall']], [
            {'mushtree': {'treestate': 'normal'}, 'growable': {'stage': 2, 'time': 0, 'sleeptime': 4836}}])
        self.assertEqual([e['components'] for e in entities['blue_mushroom']], [{}, {'mushroom': {'rain': 14}}])
        self.assertEqual([e['components'] for e in entities['mushtree_moon']], [{}, {'mushtree': {'stump': True}}])
        self.assertEqual(provenance['entityCounts']['pighead'], {'source': 3, 'imported': 3})
        self.assertEqual(provenance['entityCounts']['archive_moon_statue'], {'source': 2, 'imported': 2})
        self.assertEqual(next(e for e in provenance['entitySources'] if e['prefab'] == 'archive_moon_statue')['sourceId'], 42)
        self.assertIsNone(provenance['entitySources'][0]['sourceNode'])
        self.assertIsNone(next(e for e in provenance['entitySources'] if e.get('sourceId') == 43)['sourceNode'])
        self.assertEqual(PREFAB['convert_entities'](terrain, groups, report, 'SESSION')[0], entities)
        groups['pighead'][2]['data']['unsupported'] = True
        with self.assertRaisesRegex(ValueError, 'Unsupported pighead save state'):
            PREFAB['convert_entities'](terrain, groups, report, 'SESSION')

    def test_player_snapshot_migrates_mirrored_position_and_inventory(self):
        literals = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/dst-save-literal.py'))
        # A dedicated server's player file wraps the table in a binary header and session trailer.
        source = literals['player_snapshot']('\x03\r\x1dreturn {x=4,z=8,prefab="wortox",data={inventory={'
            'items={[1]={prefab="meat",data={stackable={stack=3},perishable={time=1440},'
            'inventoryitemmoisture={wet=true,moisture=100}}},[3]={prefab="armorwood",data={armor={condition=10}}},'
            '[4]={prefab="unknown_item"}},'
            'equip={hands={prefab="hambat"},body={prefab="backpack",skinname="backpack_catcoon",'
            'data={container={items={[2]={prefab="lantern",data={fueled={fuel=100}}}}}}}}}}}\x01\x00\x10SESSION\x00')
        catalog = {'items': {'meat': {'maxStack': 40, 'perishTime': 2880}, 'armorwood': {'maxStack': 40},
                             'hambat': {'maxStack': 40}, 'lantern': {'maxStack': 1, 'maxFuel': 468, 'equippable': 'hand'},
                             'backpack': {'maxStack': 1, 'equippable': 'body', 'canGoInContainer': False}},
                   'skins': {'backpack_catcoon': 'backpack'}}
        position, containers, report = PLAYER['convert_player'](source, [12, 0, 24], 1000, 'dst_S_U', catalog)
        self.assertEqual(position, [24, 0, -48])
        self.assertEqual(containers['player:inventory']['slots'], [
            {'slotKey': '0', 'item': {'entityId': 'dst_S_U_items_0', 'itemId': 'meat', 'count': 3, 'freshnessPercent': .5, 'wet': True}},
            {'slotKey': '2', 'item': {'entityId': 'dst_S_U_items_2', 'itemId': 'armorwood', 'count': 1}}])
        self.assertEqual(containers['player:equipment']['slots'], [{'slotKey': 'body', 'item': {
            'entityId': 'dst_S_U_equip_body', 'itemId': 'backpack', 'count': 1, 'skinId': 'backpack_catcoon',
            'container': {'slotCount': 8, 'slots': [{'slotKey': '1', 'item': {
                'entityId': 'dst_S_U_equip_body_1', 'itemId': 'lantern', 'count': 1, 'remainingFuel': 100}}]}}}])
        self.assertEqual(containers['player:cursor']['slots'], [])
        self.assertEqual(report['character'], 'wortox')
        self.assertEqual([(s['prefab'], s['reason']) for s in report['skipped']],
                         [('unknown_item', 'unknown item'), ('hambat', 'not equippable in hand')])
        self.assertEqual(report['droppedComponents'], [{'path': 'inventory.items.3', 'prefab': 'armorwood', 'components': ['armor']}])

    def test_treasurechest_import_preserves_contents_skin_and_burnt_state(self):
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'width': 3, 'height': 3, 'topology': {'ids': ['Forest']}, 'nodeidtilemap': encode([1] * 9)}
        catalog = {'items': {'log': {'maxStack': 40}, 'backpack': {'maxStack': 1, 'canGoInContainer': False}}, 'skins': {}}
        sign = {'sign': {'prefab': 'minisign', 'x': 1, 'z': 1}, 'nohuaminisign': False}
        source = {'treasurechest': [
            {'id': 5, 'x': 1, 'z': 1, 'skinname': 'treasurechest_cake', 'skin_id': 42, 'data': {
                'container': {'items': {2: {'prefab': 'log', 'data': {'stackable': {'stack': 7}}},
                                        3: {'prefab': 'backpack'}, 4: {'prefab': 'unknown_item'}}},
                'upgradeable': {'numupgrades': 0, 'stage': 1}, 'smart_minisign': sign,
                'scenariorunner': {'hasrunonce': True, 'scriptname': 'chest_abandonedboat'}}},
            {'id': 6, 'data': {'burnt': True}},
        ]}
        report = {'translation': [12, 0, 24]}
        entities, provenance = PREFAB['convert_entities'](terrain, source, report, 'BOX', catalog)
        chest, burnt = entities['treasurechest']
        self.assertEqual(chest['components'], {
            'container': {'slotCount': 9, 'slots': [{'slotKey': '1', 'item': {
                'entityId': 'dst_BOX_treasurechest_id_5_1', 'itemId': 'log', 'count': 7}}]},
            'building': {'state': 'closed', 'skinId': 'treasurechest_cake'}})
        self.assertEqual(burnt['components'], {'building': {'state': 'closed', 'burnt': True}})
        self.assertEqual([(s['path'], s['reason']) for s in provenance['containerItems']['skipped']],
                         [('treasurechest.id_5.container.3', 'cannot go in a container'),
                          ('treasurechest.id_5.container.4', 'unknown item')])
        for data, skin in [({'upgradeable': {'numupgrades': 1, 'stage': 2}}, None),
                           ({'scenariorunner': {'scriptname': 'chest_labyrinth'}}, None),
                           ({'burnt': True, 'container': {'items': {}}}, None),
                           ({}, 'treasurechest_upgraded_ancient')]:
            with self.assertRaises(ValueError):
                PREFAB['convert_entities'](terrain, {'treasurechest': [{'skinname': skin, 'data': data}]}, report, 'BOX', catalog)
        with self.assertRaisesRegex(ValueError, 'item catalog'):
            PREFAB['convert_entities'](terrain, source, report, 'BOX')

    def test_layout_entities_align_with_wood_floor_for_odd_and_even_map_dimensions(self):
        for width, height, source_centre in [(7, 5, (0, 0)), (8, 6, (-2, -2))]:
            with self.subTest(width=width, height=height):
                tiles, nodes = [1] * (width * height), [1] * (width * height)
                for row in range(2, 4):
                    for col in range(3, 5):
                        tiles[row * width + col] = 10
                # Give the region a safe spawn interior, independently of the two-by-two layout.
                for row in range(1, 4):
                    for col in range(1, 4):
                        if tiles[row * width + col] == 1:
                            tiles[row * width + col] = 14
                encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
                terrain = {'prefab': 'cave', 'width': width, 'height': height,
                           'tiles': encode(tiles), 'nodeidtilemap': encode(nodes),
                           'topology': {'ids': ['BlueForest:0:Room']},
                           'world_tile_map': {'IMPASSABLE': 1, 'WOODFLOOR': 10, 'FUNGUS': 14}}
                save, report = IMPORTER['convert'](terrain, {'players': {'local': {}}},
                                                    {'WOODFLOOR': 10, 'FUNGUS': 14}, [3, 2])
                # resurrectionstone.lua puts heads at the four midpoints of the floor's outer edges.
                cx, cz = source_centre
                heads = [{'x': cx + x, 'z': cz + z} for x, z in [(0, -4), (4, 0), (0, 4), (-4, 0)]]
                entities, _ = PREFAB['convert_entities'](terrain, {'pighead': heads}, report, 'SESSION')
                wood = {(t['col'], t['row']) for t in save['world']['map']['tiles'] if t['tileId'] == 10}
                self.assertEqual(wood, {(0, -1), (1, -1), (0, -2), (1, -2)})
                self.assertEqual([e['transform']['position'] for e in entities['pighead']],
                                 [[12, 0, 0], [24, 0, -12], [12, 0, -24], [0, 0, -12]])


if __name__ == '__main__':
    unittest.main()
