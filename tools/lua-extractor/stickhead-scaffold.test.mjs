import assert from 'node:assert/strict';
import test from 'node:test';

import { LuaFactory } from 'wasmoon';

import { unexecutedRegions } from './lua-source.mjs';
import { emitStickHeadScaffold } from './stickhead-scaffold.mjs';

test('scaffolds branch conditions, multiline statements and early returns in source order', () => {
  const source = [
    'local function update(enabled)',
    '    if enabled then',
    '        update_value(',
    '            1)',
    '    elseif has_value() then',
    '        return false',
    '    else',
    '        reset_value()',
    '    end',
    'end',
  ].join('\r\n');
  const output = emitStickHeadScaffold(source, 'prefabs/stickheads.lua', 'update');

  assert.match(output, /import type { update as LuaSignature } from '\.\/stickheads\.schema';/);
  assert.match(output, /if \(\n\/\/ Lua 2: enabled\nTODO<boolean>\(2\)/);
  assert.match(output, /\/\/ Lua 3-4: update_value\(\n\/\/   1\)\nTODO<void>\(3\);/);
  assert.match(output, /} else if \(\n\/\/ Lua 5: has_value\(\)\nTODO<boolean>\(5\)/);
  assert.match(output, /\/\/ Lua 6: return false\nreturn TODO<ReturnType<LuaSignature>>\(6\);/);
  assert.match(output, /} else {\n\/\/ Lua 8: reset_value\(\)\nTODO<void>\(8\);/);
  assert.match(output, /\/\/ Lua 10: fill the fallthrough return\.\nreturn TODO<ReturnType<LuaSignature>>\(10\);/);
  assert.throws(() => emitStickHeadScaffold(source, 'prefabs/stickheads.lua', 'missing'), /Available: update/);
});

test('lists the functions, branches and loop bodies a run did not reach, and marks them in the scaffold', async () => {
  const source = [
    'local function OnHit(inst)', // 1: never called
    '    inst.hit = true',
    'end',
    'local function fn(master, items)', // 4
    '    local inst = { tasks = {} }',
    '    if master then',
    '        inst.master = true',
    '    elseif items == nil then', // 8: not reached when master
    '        inst.client = true',
    '    else',
    '        inst.other = true',
    '    end',
    '    for _, item in ipairs(items) do', // 13: empty list
    '        inst.item = item',
    '    end',
    '    inst.OnSave = function(data)', // 16: assigned, never called
    '        data.saved = true',
    '    end',
    '    if master then inst.fast = true end', // 19: one line
    '    local handlers = { onremove = function() end }', // 20
    '    return inst',
    'end',
    'return fn(true, {})',
  ].join('\n');
  // The recorder's hooks: executed lines and the linedefined of each entered function of the file.
  const lua = await new LuaFactory().createEngine();
  try {
    lua.global.set('source', source);
    const { lines, entered } = lua.doStringSync(`
      local lines, entered = {}, {}
      debug.sethook(function(event, line)
        local info = debug.getinfo(2, "S")
        if info.source ~= "@test.lua" then return end
        if event == "line" then lines[#lines + 1] = line else entered[#entered + 1] = info.linedefined end
      end, "cl")
      assert(load(source, "@test.lua"))()
      debug.sethook()
      return { lines = table.concat(lines, ","), entered = table.concat(entered, ",") }
    `);
    const numbers = list => new Set(list.split(',').map(Number));
    const regions = unexecutedRegions(source, numbers(lines), numbers(entered));
    assert.deepEqual(
      regions.map(({ kind, clause, name, within, startLine, endLine, indeterminate }) => ({
        kind,
        ...(clause ? { clause } : {}),
        ...(name ? { name } : {}),
        ...(within ? { within } : {}),
        startLine,
        endLine,
        ...(indeterminate ? { indeterminate } : {}),
      })),
      [
        { kind: 'function', name: 'OnHit', startLine: 1, endLine: 3 },
        { kind: 'branch', clause: 'elseif', within: 'fn', startLine: 8, endLine: 9 },
        { kind: 'branch', clause: 'else', within: 'fn', startLine: 10, endLine: 11 },
        { kind: 'loop', within: 'fn', startLine: 13, endLine: 14 },
        { kind: 'function', name: 'inst.OnSave', startLine: 16, endLine: 18 },
        { kind: 'branch', clause: 'if', within: 'fn', startLine: 19, endLine: 19, indeterminate: true },
        { kind: 'function', name: 'onremove', startLine: 20, endLine: 20 },
      ],
    );

    const scaffold = emitStickHeadScaffold(source, 'prefabs/test.lua', 'fn', { schema: 'test', unexecuted: regions });
    assert.match(scaffold, /^\/\/ Scaffold from prefabs\/test\.lua:4\.\n\/\/ Lua 8-9 \(elseif\): no recorded scenario/);
    assert.match(scaffold, /\/\/ Lua 13-14 \(loop body\): no recorded scenario runs it/);
    assert.match(scaffold, /\/\/ Lua 19 \(if\): shares its line with the condition/);
    assert.match(
      scaffold,
      /} else {\n\/\/ Lua 10-11 \(else\): no recorded scenario runs it; port it from the Lua source\.\n/,
    );
    assert.doesNotMatch(scaffold, /Lua 6-7 \(if\)/);
    assert.match(
      emitStickHeadScaffold(source, 'prefabs/test.lua', 'OnHit', { schema: 'test', unexecuted: regions }),
      /No recorded scenario runs this function/,
    );
  } finally {
    lua.global.close();
  }
});
