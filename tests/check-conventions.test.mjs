import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('../scripts/check-conventions.mjs', import.meta.url).pathname;
const run = (root, ...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'conventions-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const prefab = `
import { PrefabInstance } from './prefabInstance';
export class TentInstance extends PrefabInstance {
  startSleepSound(): void {}
}
export function fn(inst: TentInstance, model: { userData: Record<string, unknown> }) {
  inst.components.workable = undefined;
  inst.components.workable!.owner = undefined;
  model.userData.removed = true;
  // conventions-allow userdata: a bare FX model without an instance.
  model.userData.flag = true;
  inst.sg?.pushEvent('animover');
}
`;

test('reports the rule each construct breaks, and honours an allowance', () => {
  const root = tree({ 'packages/prefab/src/tent.ts': prefab });
  try {
    const { violations } = JSON.parse(
      execFileSync(process.execPath, [script, '--root', root, '--json'], { encoding: 'utf8' }),
    );
    assert.deepEqual(
      violations.map(({ line, rule }) => `${line} ${rule}`),
      ['4 instance-method', '7 components-write', '9 userdata', '12 sg-forward'],
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('the baseline fails only where a file gains a violation of a rule', () => {
  const root = tree({ 'packages/prefab/src/tent.ts': prefab });
  const baseline = join(root, 'baseline.json');
  try {
    assert.equal(run(root, '--write-baseline', baseline).status, 0);
    assert.equal(run(root, '--baseline', baseline).status, 0);
    writeFileSync(
      join(root, 'packages/prefab/src/tent.ts'),
      `${prefab}\nexport const more = (inst: TentInstance) => { inst.components.health = undefined; };\n`,
    );
    const grown = run(root, '--baseline', baseline);
    assert.equal(grown.status, 1);
    // Both components-write lines are listed (the rule's count grew in that file); the unchanged userdata is not.
    const listed = grown.stdout.split('\nrule ')[0];
    assert.equal(listed.match(/components-write/g)?.length, 2);
    assert.doesNotMatch(listed, /userdata/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
