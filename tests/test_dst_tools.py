import json
import runpy
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = runpy.run_path(str(ROOT / 'scripts/dst-lua-inventory.py'))
SAVE_DIFF = runpy.run_path(str(ROOT / 'scripts/dst-save-diff.py'))

PREFAB = '''
local assets = { Asset("ANIM", "anim/thing.zip") }
-- inst:AddTag("commented_out")
local function OnSave(inst, saved)
    saved.broken = inst.broken
end
local function OnLoad(inst, data)
    if data ~= nil and data.broken then
        inst.AnimState:PlayAnimation("broken")
    end
end
local function fn()
    local inst = CreateEntity()
    inst.AnimState:SetBank ("thing")
    inst.AnimState:PlayAnimation("idle", true)
    inst:AddTag("thing")
    MakeHelper(inst)
    inst:AddComponent("widget")
    inst.OnSave = OnSave
    inst.OnLoad = OnLoad
    return inst
end
return Prefab("thing", fn, assets)
'''
STANDARD = '''
function MakeHelper(inst)
    inst:AddTag("from_helper")
    MakeNested(inst)
end
function MakeNested(inst)
    inst:AddComponent("nestedcomponent")
    inst:ListenForEvent("nestedevent", inst.fn)
end
'''
COMPONENT = '''
local Widget = Class(function(self, inst)
    self.inst = inst
    inst:AddTag("from_component")
end)
function Widget:Later()
    self.inst:AddTag("not_constructor")
end
return Widget
'''


class LuaInventoryTest(unittest.TestCase):
    def test_lists_declarations_and_expands_helpers_and_components(self):
        with tempfile.TemporaryDirectory() as directory:
            scripts = Path(directory)
            (scripts / 'prefabs').mkdir()
            (scripts / 'components').mkdir()
            (scripts / 'prefabs/thing.lua').write_text(PREFAB)
            (scripts / 'standardcomponents.lua').write_text(STANDARD)
            (scripts / 'components/widget.lua').write_text(COMPONENT)
            output = StringIO()
            with redirect_stdout(output):
                status = INVENTORY['main'](['thing', '--scripts', str(scripts)])
        text = output.getvalue()
        self.assertEqual(status, 0)
        self.assertIn('fn inst.AnimState:SetBank ("thing")', text)
        self.assertIn('OnLoad ? inst.AnimState:PlayAnimation("broken")', text)
        self.assertNotIn('commented_out', text)
        self.assertIn('save fields: OnSave: broken; OnLoad: broken', text)
        self.assertIn('MakeHelper: tags from_helper; calls MakeNested; components nestedcomponent; events nestedevent', text)
        self.assertIn('widget: ctor tags from_component; TS missing', text)
        self.assertNotIn('not_constructor', text)


class SaveDiffTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name)
        self.output = self.repo / 'saves'
        self.output.mkdir()
        self.git('init', '-q')
        self.world = {'world': {'entities': {'rock': [{'id': 1}]}, 'tiles': 'a'}}
        self.report = {'entityCounts': {'rock': {'source': 1, 'imported': 1}}, 'entityWhitelist': ['rock'], 'entitySources': []}
        self.write(self.world, self.report)
        self.git('add', '.')
        self.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'base')

    def git(self, *args):
        subprocess.run(['git', '-C', str(self.repo), *args], check=True)

    def write(self, world, report):
        (self.output / 'Caves.json').write_text(json.dumps(world))
        (self.output / 'Caves.import.json').write_text(json.dumps(report))

    def diff(self, *expect):
        output = StringIO()
        with redirect_stdout(output):
            status = SAVE_DIFF['run'](self.repo, 'HEAD', self.output, set(expect))
        return status, output.getvalue()

    def add_pillar(self, tiles='a'):
        world = {'world': {'entities': {**self.world['world']['entities'], 'pillar': [{'id': 2, 'components': {'broken': True}}]}, 'tiles': tiles}}
        report = {**self.report, 'entityCounts': {**self.report['entityCounts'], 'pillar': {'source': 1, 'imported': 1}}, 'entityWhitelist': ['rock', 'pillar']}
        self.write(world, report)

    def test_expected_group_passes_and_reports_counts_and_fields(self):
        self.add_pillar()
        status, text = self.diff('pillar')
        self.assertEqual(status, 0, text)
        self.assertIn('pillar: added 0->1 in 1 worlds; 1 reports', text)
        self.assertIn('Caves pillar 1/1 of 1 records, components: broken=1', text)

    def test_unexpected_entity_and_world_changes_fail(self):
        self.add_pillar(tiles='b')
        status, text = self.diff('pillar')
        self.assertEqual(status, 1)
        self.assertIn('Caves.json: world.tiles', text)
        status, text = self.diff('rock')
        self.assertEqual(status, 1)
        self.assertIn('unexpected entity group: pillar', text)
        self.assertIn('expected but unchanged: rock', text)


if __name__ == '__main__':
    unittest.main()
