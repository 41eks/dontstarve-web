import base64
from pathlib import Path
import runpy
import struct
import unittest

IMPORTER = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/import-dst-region.py'))


class RegionImportTest(unittest.TestCase):
    def test_region_crop_remaps_ids_and_preserves_holes(self):
        width, height = 7, 5
        tiles, nodes = [1] * (width * height), [0] * (width * height)
        for z in range(1, 4):
            for x in range(1, 4):
                tiles[z * width + x], nodes[z * width + x] = 14, 1
        tiles[2 * width + 4], nodes[2 * width + 4] = 200, 2
        tiles[2 * width + 5], nodes[2 * width + 5] = 45, 2
        encode = lambda values: base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack(f'<{len(values)}H', *values)).decode()
        terrain = {'prefab': 'cave', 'width': width, 'height': height,
                   'tiles': encode(tiles), 'nodeidtilemap': encode(nodes),
                   'topology': {'ids': ['BlueForest:0:Forest', 'ArchiveMaze:0:Room']},
                   'world_tile_map': {'IMPASSABLE': 1, 'FUNGUS': 14, 'ARCHIVE': 45, 'FAKE_GROUND': 200}}
        template = {'players': {'local': {'ghost': True, 'inventory': {'old': 'discard'}}}}
        result, report = IMPORTER['convert'](terrain, template, ['BlueForest', 'ArchiveMaze'],
                                             {'FUNGUS': 256, 'ARCHIVE': 45, 'FAKE_GROUND': 200})
        self.assertEqual(result['world']['prefab'], 'cave')
        self.assertEqual(result['world']['map']['defaultTileId'], 1)
        self.assertEqual(report['landCells'], 10)
        self.assertEqual(report['tileCounts'], {'ARCHIVE': 1, 'FAKE_GROUND': 1, 'FUNGUS': 9})
        cells = {(t['col'], t['row']): t['tileId'] for t in result['world']['map']['tiles']}
        self.assertEqual(cells, {(x - 3, z - 2): 256 for x in range(1, 4) for z in range(1, 4)} | {(1, 0): 200, (2, 0): 45})
        self.assertEqual(result['players']['local']['transform']['position'], [-6, 0, 6])
        self.assertNotIn('ghost', result['players']['local'])
        self.assertEqual(result['world']['entities'], {})
        self.assertIn('ghost', template['players']['local'])
        extended, _ = IMPORTER['convert'](terrain, template, ['BlueForest', 'ArchiveMaze'],
                                         {'FUNGUS': 256, 'ARCHIVE': 45, 'FAKE_GROUND': 200}, [5, 2])
        self.assertEqual(extended['world']['map']['tiles'],
                         [{**tile, 'col': tile['col'] - 2} for tile in result['world']['map']['tiles']])
        with self.assertRaisesRegex(ValueError, 'Unknown regions'):
            IMPORTER['convert'](terrain, template, ['Unknown'], {})
        with self.assertRaisesRegex(ValueError, 'Unsupported terrain'):
            IMPORTER['convert'](terrain, template, ['BlueForest'], {})

    def test_rejects_bad_grid_and_lua_code_without_execution(self):
        for raw in [b'garbage', b'VRSN\0\x02\0\0\0\x01\0', b'VRSN\0\x01\0\0\0']:
            with self.assertRaises(ValueError):
                IMPORTER['decode_grid'](base64.b64encode(raw).decode(), 1, 1)
        reader = IMPORTER['LITERALS']['returned_table']
        self.assertEqual(reader('KLEI     1 return {session_id="ABC", nested={true, false, 2.5}}'),
                         {'session_id': 'ABC', 'nested': [True, False, 2.5]})
        with self.assertRaises(ValueError):
            reader('return {session_id=os.execute("touch /tmp/should-not-execute")}')

    def test_entity_whitelist_filters_regions_and_preserves_source_state_and_identity(self):
        nodes = [0] * 48
        nodes[3 * 8 + 3] = nodes[3 * 8 + 4] = 1
        terrain = {'width': 8, 'height': 6, 'topology': {'ids': ['BlueForest:0:Room']},
                   'nodeidtilemap': base64.b64encode(b'VRSN\0\x01\0\0\0' + struct.pack('<48H', *nodes)).decode()}
        # The second selected cell is void: source statues still belong to the region there.
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
        groups = IMPORTER['LITERALS']['snapshot_entities'](source, IMPORTER['ENTITY_WHITELIST'])
        entities, provenance = IMPORTER['convert_entities'](terrain, groups, report, 'SESSION')
        self.assertEqual(set(entities), {'pighead', 'archive_moon_statue', 'cave_exit', 'mushtree_medium', 'mushtree_moon', 'mushtree_tall', 'blue_mushroom',
                                    'grotto_pool_big', 'grotto_pool_small', 'grotto_moonglass_1', 'grotto_waterfall_big', 'grotto_waterfall_small2'})
        self.assertEqual(entities['pighead'], [
            {'id': 'dst_SESSION_pighead_index_000002', 'transform': {'position': [0, 0, -24], 'rotationY': 0},
             'components': {'building': {'state': 'idle'}}},
            {'id': 'dst_SESSION_pighead_id_9', 'transform': {'position': [12, 0, -24], 'rotationY': 0},
             'components': {'building': {'state': 'idle', 'burnt': True}}},
        ])
        self.assertEqual(entities['archive_moon_statue'], [
            {'id': 'dst_SESSION_archive_moon_statue_id_42', 'transform': {'position': [12, 0, -24], 'rotationY': 0},
             'components': {'archiveProp': {'anim': 4}}},
        ])
        self.assertEqual(entities['cave_exit'], [
            {'id': 'dst_SESSION_cave_exit_id_7', 'transform': {'position': [12, 0, -24], 'rotationY': 0}, 'components': {}}])
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
        self.assertEqual(provenance['entityCounts']['pighead'], {'source': 3, 'imported': 2, 'outsideRegion': 1})
        self.assertEqual(provenance['entityCounts']['archive_moon_statue'], {'source': 2, 'imported': 1, 'outsideRegion': 1})
        self.assertEqual(next(e for e in provenance['entitySources'] if e['prefab'] == 'archive_moon_statue')['sourceId'], 42)
        self.assertEqual(IMPORTER['convert_entities'](terrain, groups, report, 'SESSION')[0], entities)
        groups['pighead'][2]['data']['unsupported'] = True
        with self.assertRaisesRegex(ValueError, 'Unsupported pighead save state'):
            IMPORTER['convert_entities'](terrain, groups, report, 'SESSION')

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
                save, report = IMPORTER['convert'](terrain, {'players': {'local': {}}}, ['BlueForest'],
                                                    {'WOODFLOOR': 10, 'FUNGUS': 14}, [3, 2])
                # resurrectionstone.lua puts heads at the four midpoints of the floor's outer edges.
                cx, cz = source_centre
                heads = [{'x': cx + x, 'z': cz + z} for x, z in [(0, -4), (4, 0), (0, 4), (-4, 0)]]
                entities, _ = IMPORTER['convert_entities'](terrain, {'pighead': heads}, report, 'SESSION')
                wood = {(t['col'], t['row']) for t in save['world']['map']['tiles'] if t['tileId'] == 10}
                self.assertEqual(wood, {(0, 0), (1, 0), (0, 1), (1, 1)})
                self.assertEqual([e['transform']['position'] for e in entities['pighead']],
                                 [[12, 0, 0], [24, 0, 12], [12, 0, 24], [0, 0, 12]])


if __name__ == '__main__':
    unittest.main()
