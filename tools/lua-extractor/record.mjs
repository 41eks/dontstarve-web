import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LuaFactory } from 'wasmoon';

import { scanClipPlays } from './clip-scan.mjs';

import {
  localFunctionNodes,
  luaParameterNames,
  parseLuaSource,
  returnsValue,
  unexecutedRegions,
} from './lua-source.mjs';

const runtime = ['recorder.lua', 'sandbox.lua'].map(file =>
  readFileSync(new URL('runtime/' + file, import.meta.url), 'utf8'),
);
const defaultScenarios = [
  { name: 'client', master: false, fullMoon: false, seed: 42 },
  { name: 'master', master: true, fullMoon: false, seed: 42 },
  { name: 'master-full-moon', master: true, fullMoon: true, seed: 43 },
];

function getSourceNodes(file, readSource, sourceNodes) {
  if (!sourceNodes.has(file)) {
    sourceNodes.set(file, parseLuaSource(readSource(file)));
  }
  return sourceNodes.get(file);
}

function describeFunction(node, file) {
  const { identifier, loc } = node;
  return {
    file,
    ...(identifier?.type === 'Identifier' ? { name: identifier.name } : {}),
    parameters: luaParameterNames(node),
    startLine: loc.start.line,
    endLine: loc.end.line,
    startColumn: loc.start.column,
    endColumn: loc.end.column,
  };
}

function staticFunctionUses(nodes) {
  const uses = new Map();
  for (const node of nodes) {
    if (node.type !== 'CallExpression' || node.arguments[1]?.type !== 'Identifier' || !node.arguments[1].isLocal) {
      continue;
    }
    const { base } = node;
    const kind =
      base.type === 'Identifier' && base.name === 'Prefab' && !base.isLocal
        ? 'Prefab'
        : base.indexer === ':' && base.identifier?.name === 'DoTaskInTime'
          ? 'DoTaskInTime'
          : undefined;
    if (kind) {
      const { name } = node.arguments[1];
      const references = uses.get(name) ?? [];
      references.push({ kind, line: node.loc.start.line });
      uses.set(name, references);
    }
  }
  return uses;
}

function listLocalFunctions(file, readSource, sourceNodes) {
  const nodes = getSourceNodes(file, readSource, sourceNodes);
  const topLevel = new Set(nodes.find(node => node.type === 'Chunk').body);
  const declarations = localFunctionNodes(nodes);
  const counts = new Map();
  for (const { identifier } of declarations) {
    counts.set(identifier.name, (counts.get(identifier.name) ?? 0) + 1);
  }
  const uses = staticFunctionUses(nodes);
  return declarations.map(node => {
    const { name } = node.identifier;
    // Leave shadowed names to the runtime identity or the unknown-type fallback.
    const references = counts.get(name) === 1 ? uses.get(name) : undefined;
    return {
      ...describeFunction(node, file),
      topLevel: topLevel.has(node),
      returnsValue: returnsValue(node.body),
      ...(references ? { staticUses: references } : {}),
    };
  });
}

function locateCallback(callback, readSource, sourceNodes) {
  const { file, startLine, endLine } = callback;
  const matches = getSourceNodes(file, readSource, sourceNodes).filter(
    node => node.type === 'FunctionDeclaration' && node.loc.start.line === startLine && node.loc.end.line === endLine,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one callback declaration at ${file}:${startLine}-${endLine}, found ${matches.length}`);
  }
  return { ...callback, ...describeFunction(matches[0], file) };
}

export async function recordPrefab(
  sourceRoot,
  file,
  prefab,
  { includeCallbackSource = false, scenarios = defaultScenarios, requires = [] } = {},
) {
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
  // The prefab file's executed lines and entered functions (by linedefined), over every scenario.
  const executedLines = new Set();
  const enteredFunctions = new Set();
  for (const scenario of scenarios) {
    const lua = await factory.createEngine({ enableProxy: false, injectObjects: false, functionTimeout: 5000 });
    try {
      lua.global.set('readSource', readSource);
      lua.global.set('prefabFile', file);
      lua.global.set('prefabId', prefab);
      lua.global.set('scenario', scenario);
      lua.global.set('recorderSource', runtime[0]);
      lua.global.set('sandboxSource', runtime[1]);
      lua.global.set('extraRequires', requires);
      const { result, lines, entered } = lua.doStringSync(`
        local recorder = assert(load(recorderSource, "@recorder.lua"))()
        local record = assert(load(sandboxSource, "@sandbox.lua"))()
        -- Coverage of the prefab file: a line hook for executed lines, a call hook for entered functions.
        local target, lines, entered = "@" .. prefabFile, {}, {}
        debug.sethook(function(event, line)
          local info = debug.getinfo(2, "S")
          if info == nil or info.source ~= target then
            return
          end
          if event == "line" then
            lines[line] = true
          else
            entered[info.linedefined] = true
          end
        end, "cl")
        local ok, result = pcall(record, recorder, readSource, prefabFile, prefabId, scenario, extraRequires)
        debug.sethook()
        if not ok then
          error(result, 0)
        end
        local function keys(set)
          local out = {}
          for key in pairs(set) do
            out[#out + 1] = key
          end
          table.sort(out)
          return table.concat(out, ",")
        end
        return { result = result, lines = keys(lines), entered = keys(entered) }
      `);
      for (const line of lines.split(',').filter(Boolean)) {
        executedLines.add(Number(line));
      }
      for (const line of entered.split(',').filter(Boolean)) {
        enteredFunctions.add(Number(line));
      }
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
            if (
              key === 'args' ||
              key === 'operations' ||
              key === 'assets' ||
              key === 'prefabDependencies' ||
              key === 'spawned' ||
              key === 'skins'
            ) {
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
  const unexecuted = unexecutedRegions(readSource(file), executedLines, enteredFunctions);
  const clipPlays = recordedClipPlays(file, readSource, recordings, unexecuted);
  // After every scan, so each file a scan read is an input.
  const inputs = [...sources.keys()].sort().map(path => ({
    path,
    sha256: createHash('sha256').update(sources.get(path)).digest('hex'),
  }));
  return {
    version: 1,
    prefab,
    file,
    inputs,
    localFunctions: listLocalFunctions(file, readSource, sourceNodes),
    unexecuted,
    clipPlays,
    recordings,
  };
}

/**
 * `TheWorld.state.<key>` for each string state key the scenarios set, with every value they give it: a clip name built
 * from world state (SGmoondial's `anim.."_"..TheWorld.state.moonphase`) is enumerated over the recorded states.
 */
function scenarioDomains(recordings) {
  const domains = {};
  for (const { scenario } of recordings) {
    for (const [key, value] of Object.entries(scenario.state ?? {})) {
      if (typeof value === 'string') {
        const domain = (domains[`TheWorld.state.${key}`] ??= []);
        if (!domain.includes(value)) {
          domain.push(value);
        }
      }
    }
  }
  return domains;
}

/**
 * The prefab file's AnimState plays (scanClipPlays); those of each callback another file defines that a recording
 * registered, such as standardcomponents.lua's DefaultBurntStructureFn; and those of each stategraph a recording set
 * with inst:SetStateGraph, from stategraphs/<name>.lua. A play in the prefab file says whether any scenario ran its
 * line; the others have no coverage.
 */
function recordedClipPlays(file, readSource, recordings, unexecuted) {
  const options = { domains: scenarioDomains(recordings) };
  const notRun = line =>
    unexecuted.some(region => !region.indeterminate && line >= region.startLine && line <= region.endLine);
  const plays = scanClipPlays(readSource(file), file, undefined, options).map(play => ({
    ...play,
    ran: !notRun(play.line),
  }));
  const stategraphs = new Set();
  for (const { operations } of recordings) {
    for (const operation of operations) {
      if (operation.target === 'inst' && operation.name === 'SetStateGraph' && typeof operation.args[0] === 'string') {
        stategraphs.add(operation.args[0]);
      }
    }
  }
  for (const stategraph of [...stategraphs].sort()) {
    const path = `stategraphs/${stategraph}.lua`;
    plays.push(...scanClipPlays(readSource(path), path, undefined, options));
  }
  const callbacks = new Map();
  for (const { operations } of recordings) {
    for (const operation of operations) {
      for (const argument of operation.args) {
        if (argument?.kind === 'callback' && argument.file !== file) {
          callbacks.set(`${argument.file}:${argument.startLine}`, argument);
        }
      }
    }
  }
  for (const callback of [...callbacks.values()].sort((a, b) =>
    a.file === b.file ? a.startLine - b.startLine : a.file < b.file ? -1 : 1,
  )) {
    plays.push(...scanClipPlays(readSource(callback.file), callback.file, callback, options));
  }
  return plays;
}
