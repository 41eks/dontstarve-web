import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import luaparse from 'luaparse';
import { LuaFactory } from 'wasmoon';

const runtime = ['recorder.lua', 'sandbox.lua'].map(file =>
  readFileSync(new URL('runtime/' + file, import.meta.url), 'utf8'),
);
const scenarios = [
  { name: 'client', master: false, fullMoon: false, seed: 42 },
  { name: 'master', master: true, fullMoon: false, seed: 42 },
  { name: 'master-full-moon', master: true, fullMoon: true, seed: 43 },
];

function getSourceNodes(file, readSource, sourceNodes) {
  if (!sourceNodes.has(file)) {
    const nodes = [];
    luaparse.parse(readSource(file), {
      luaVersion: '5.1',
      locations: true,
      onCreateNode(node) {
        if (node.type === 'FunctionDeclaration' || node.type === 'CallExpression') {
          nodes.push(node);
        }
      },
    });
    sourceNodes.set(file, nodes);
  }
  return sourceNodes.get(file);
}

function locateCallback(callback, readSource, sourceNodes) {
  const { file, startLine, endLine } = callback;
  const matches = getSourceNodes(file, readSource, sourceNodes).filter(
    node => node.type === 'FunctionDeclaration' && node.loc.start.line === startLine && node.loc.end.line === endLine,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one callback declaration at ${file}:${startLine}-${endLine}, found ${matches.length}`);
  }
  const { identifier, loc, parameters } = matches[0];
  return {
    ...callback,
    ...(identifier?.type === 'Identifier' ? { name: identifier.name } : {}),
    parameters: parameters.map(parameter => (parameter.type === 'Identifier' ? parameter.name : '...')),
    startColumn: loc.start.column,
    endColumn: loc.end.column,
  };
}

export async function recordPrefab(sourceRoot, file, prefab, { includeCallbackSource = false } = {}) {
  const sources = new Map();
  const sourceNodes = new Map();
  function readSource(path) {
    if (!/^(?:[\w-]+\/)*[\w-]+\.lua$/.test(path)) {
      throw new Error(`Invalid Lua source path: ${path}`);
    }
    if (!sources.has(path)) {
      sources.set(path, readFileSync(resolve(sourceRoot, path)));
    }
    return sources.get(path).toString('utf8');
  }

  const factory = new LuaFactory();
  const recordings = [];
  for (const scenario of scenarios) {
    const lua = await factory.createEngine({ enableProxy: false, injectObjects: false, functionTimeout: 5000 });
    try {
      lua.global.set('readSource', readSource);
      lua.global.set('prefabFile', file);
      lua.global.set('prefabId', prefab);
      lua.global.set('scenario', scenario);
      lua.global.set('recorderSource', runtime[0]);
      lua.global.set('sandboxSource', runtime[1]);
      const result = lua.doStringSync(`
        local recorder = assert(load(recorderSource, "@recorder.lua"))()
        local record = assert(load(sandboxSource, "@sandbox.lua"))()
        return record(recorder, readSource, prefabFile, prefabId, scenario)
      `);
      const observed = JSON.parse(
        JSON.stringify(result, (key, value) => {
          if (value?.kind === 'callback') {
            value = locateCallback(value, readSource, sourceNodes);
            if (includeCallbackSource) {
              const lines = readSource(value.file).split(/\r\n|\n\r|[\n\r]/);
              const slice = lines.slice(value.startLine - 1, value.endLine);
              slice[slice.length - 1] = slice.at(-1).slice(0, value.endColumn);
              slice[0] = slice[0].slice(value.startColumn);
              value = { ...value, sourceText: slice.join('\n') };
            }
          }
          if (value?.kind === 'call' && value.target === 'components.workable' && value.name === 'SetWorkLeft') {
            const { file, line } = value.source;
            const calls = getSourceNodes(file, readSource, sourceNodes).filter(
              node =>
                node.type === 'CallExpression' &&
                node.base.identifier?.name === 'SetWorkLeft' &&
                node.base.base?.identifier?.name === 'workable' &&
                node.loc.start.line === line,
            );
            const argument = calls[0]?.arguments[0];
            if (calls.length === 1 && argument?.type === 'NumericLiteral' && argument.value === value.args[0]) {
              value = { ...value, literalArgument: argument.raw };
            }
          }
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value).sort();
            if (key === 'args' || key === 'operations' || key === 'assets' || key === 'prefabDependencies') {
              if (keys.length !== 0) {
                throw new Error(`Expected a Lua sequence for ${key}`);
              }
              return [];
            }
            return Object.fromEntries(keys.map(key => [key, value[key]]));
          }
          return value;
        }),
      );
      recordings.push({ scenario, ...observed });
    } catch (error) {
      throw new Error(`${prefab} (${scenario.name}): ${error.message}`, { cause: error });
    } finally {
      lua.global.close();
    }
  }
  const inputs = [...sources.keys()].sort().map(path => ({
    path,
    sha256: createHash('sha256').update(sources.get(path)).digest('hex'),
  }));
  return { version: 1, prefab, file, inputs, recordings };
}
