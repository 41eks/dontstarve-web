import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { format } from 'prettier';

import { recordPrefab } from './record.mjs';
import { moondialConfig, moondialProfile, moondialSignatures } from './moondial-config.mjs';
import { woodChairConfig, woodChairProfile, woodChairSignatures } from './wood-chair-config.mjs';
import { stickHeadConfig } from './stickhead-config.mjs';
import { emitStickHeadScaffold } from './stickhead-scaffold.mjs';
import { emitStickHeadSignatures } from './stickhead-signatures.mjs';

const { values } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    'source-root': { type: 'string', default: process.env.DST_LUA_ROOT },
    check: { type: 'boolean' },
    'callback-source': { type: 'boolean' },
    scaffold: { type: 'string' },
    unexecuted: { type: 'boolean' },
    prefab: { type: 'string', default: 'pighead' },
  },
});

function* differences(previous, current, path) {
  if (isDeepStrictEqual(previous, current)) {
    return;
  }
  if (
    previous !== null &&
    typeof previous === 'object' &&
    current !== null &&
    typeof current === 'object' &&
    Array.isArray(previous) === Array.isArray(current)
  ) {
    for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
      const operation = current[key];
      const member = Array.isArray(current)
        ? `[${key}]${operation?.target && operation?.name ? ` (${operation.target}.${operation.name})` : ''}`
        : `.${key}`;
      yield* differences(previous[key], current[key], path + member);
    }
    return;
  }
  yield `${path}: ${JSON.stringify(previous) ?? '(missing)'} -> ${JSON.stringify(current) ?? '(missing)'}`;
}

async function updateFile(file, output, check) {
  if (!check) {
    await writeFile(file, output);
    return;
  }
  const previous = await readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });
  if (previous === output) {
    return;
  }

  console.error(`${file.pathname} is out of date`);
  if (file.pathname.endsWith('.json') && previous) {
    let count = 0;
    for (const change of differences(JSON.parse(previous), JSON.parse(output), values.prefab)) {
      console.error(`  ${change}`);
      if (++count === 10) {
        break;
      }
    }
  }
  process.exitCode = 1;
}

/** How many functions and branches no scenario ran, for the generation summary. */
function unexecutedSummary({ unexecuted }) {
  const functions = unexecuted.filter(({ kind }) => kind === 'function').length;
  return `; Lua regions no scenario ran: ${functions} function(s), ${unexecuted.length - functions} branch or loop body(ies), listed by --unexecuted`;
}

// Profiles whose snapshot generates one schema module: packages/prefab/src/generated/<prefab>.schema.ts.
const PROFILES = {
  moondial: {
    profile: moondialProfile,
    config: moondialConfig,
    signatures: moondialSignatures,
    constant: 'MOONDIAL_CONFIG',
  },
  wood_chair: {
    profile: woodChairProfile,
    config: woodChairConfig,
    signatures: woodChairSignatures,
    constant: 'WOOD_CHAIR_CONFIG',
  },
};

/** The checked-in snapshot of `prefab`, which must have been recorded from this `source`. */
async function checkedSnapshot(prefab, file, source) {
  const snapshot = JSON.parse(await readFile(new URL(`snapshots/${prefab}.json`, import.meta.url), 'utf8'));
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (snapshot.inputs.find(({ path }) => path === file)?.sha256 !== sha256) {
    throw new Error(
      `snapshots/${prefab}.json was recorded from another ${file}; run pnpm extract:lua --prefab ${prefab}`,
    );
  }
  return snapshot;
}

async function main() {
  if (!values['source-root']) {
    throw new Error('Pass --source-root <DST scripts directory> or set DST_LUA_ROOT');
  }
  const scaffold = values.scaffold !== undefined;
  if ([values.check, values['callback-source'], scaffold, values.unexecuted].filter(Boolean).length > 1) {
    throw new Error('Use only one of --check, --callback-source, --scaffold and --unexecuted');
  }
  const prefab = values.prefab;
  if (prefab !== 'pighead' && !Object.hasOwn(PROFILES, prefab)) {
    throw new Error(`Unsupported prefab: ${prefab}`);
  }
  const generated = PROFILES[prefab];
  const profile = generated?.profile ?? { file: 'prefabs/stickheads.lua' };
  const { file } = profile;
  if (scaffold || values.unexecuted) {
    const source = await readFile(resolve(values['source-root'], file), 'utf8');
    const { unexecuted } = await checkedSnapshot(prefab, file, source);
    if (values.unexecuted) {
      for (const region of unexecuted) {
        const { kind, clause, name, within, startLine, endLine, indeterminate, text } = region;
        const what = kind === 'function' ? `function ${name}` : `${kind === 'branch' ? clause : 'loop'} in ${within}`;
        const lines = startLine === endLine ? startLine : `${startLine}-${endLine}`;
        console.log(`${file}:${lines} ${what}${indeterminate ? ' (indeterminate)' : ''}: ${text}`);
      }
      return;
    }
    const output = emitStickHeadScaffold(source, file, values.scaffold, {
      ...(generated ? { schema: prefab, typeImports: profile.typeImports } : {}),
      unexecuted,
    });
    process.stdout.write(
      await format(output, { parser: 'typescript', singleQuote: true, printWidth: 120, arrowParens: 'avoid' }),
    );
    return;
  }
  const snapshot = await recordPrefab(values['source-root'], file, prefab, {
    scenarios: profile.scenarios,
    requires: profile.requires,
    includeCallbackSource: values['callback-source'],
  });
  const json = JSON.stringify(snapshot, null, 2) + '\n';
  if (values['callback-source']) {
    process.stdout.write(json);
    return;
  }

  if (generated) {
    const config = generated.config(snapshot);
    const schema = await format(
      `// Generated by pnpm extract:lua --prefab ${prefab} from ${file}.
${generated.signatures(snapshot)}

export const ${generated.constant} = ${JSON.stringify(config, null, 2)} as const;
`,
      { parser: 'typescript', singleQuote: true, printWidth: 120, trailingComma: 'all' },
    );
    await updateFile(new URL(`snapshots/${prefab}.json`, import.meta.url), json, values.check);
    await updateFile(
      new URL(`../../packages/prefab/src/generated/${prefab}.schema.ts`, import.meta.url),
      schema,
      values.check,
    );
    if (!process.exitCode) {
      console.log(
        `${values.check ? 'Verified' : 'Generated'} ${prefab} (${snapshot.recordings.length} scenarios, ${snapshot.localFunctions.length} signatures${unexecutedSummary(snapshot)}).`,
      );
    }
    return;
  }

  // Both existing variants call the same Lua constructor. Record each so variant-specific
  // changes can flow through the shared TS factory without copying a sibling's settings.
  const mermhead = await recordPrefab(values['source-root'], snapshot.file, 'mermhead');
  const declarations = { pighead: stickHeadConfig(snapshot), mermhead: stickHeadConfig(mermhead) };
  const signatures = emitStickHeadSignatures([snapshot, mermhead]);
  const schemaFile = new URL('../../packages/prefab/src/generated/stickheads.schema.ts', import.meta.url);
  const schema = await format(
    `// Generated by pnpm extract:lua from ${snapshot.file}.
${signatures}

export const STICK_HEAD_CONFIG = ${JSON.stringify(declarations, null, 2)} as const;
`,
    { parser: 'typescript', singleQuote: true, printWidth: 120, trailingComma: 'all' },
  );

  // The save archive picker reads the shared building catalog. Its two art fields mirror
  // the declaration so fresh placement, save loading and archive selection agree.
  const catalogFile = new URL('../../packages/prefab/src/definitions.json', import.meta.url);
  let catalogText = await readFile(catalogFile, 'utf8');
  const catalog = JSON.parse(catalogText);
  for (const [id, { archive, idleAnimation }] of Object.entries(declarations)) {
    const entry = catalog.animatedBuildings[id];
    if (entry.archive !== archive || entry.idleAnimation !== idleAnimation) {
      const row = value => `    "${id}": ${JSON.stringify(value, null, 2).replaceAll('\n', '\n    ')}`;
      const previous = row(entry);
      if (!catalogText.includes(previous)) {
        throw new Error(`Couldn't find the building catalog row for ${id}`);
      }
      catalogText = catalogText.replace(previous, () => row({ ...entry, archive, idleAnimation }));
    }
  }
  await updateFile(new URL('snapshots/pighead.json', import.meta.url), json, values.check);
  await updateFile(schemaFile, schema, values.check);
  await updateFile(catalogFile, catalogText, values.check);
  if (!process.exitCode) {
    const counts = snapshot.recordings.map(({ scenario, operations }) => `${scenario.name} ${operations.length}`);
    console.log(
      `${values.check ? 'Verified' : 'Generated'} pighead (${counts.join(', ')}; ${snapshot.localFunctions.length} local function signatures${unexecutedSummary(snapshot)}).`,
    );
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
