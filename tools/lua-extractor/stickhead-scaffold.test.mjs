import assert from 'node:assert/strict';
import test from 'node:test';

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
