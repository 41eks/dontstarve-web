import luaparse from 'luaparse';

import { facingNames } from './anim-bin.mjs';

const SINKS = { PlayAnimation: 'play', PushAnimation: 'push' };

function parse(source) {
  return luaparse.parse(source, { luaVersion: '5.1', locations: true, ranges: true, scope: true });
}

function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === 'object' && typeof item.type === 'string') {
        children.push(item);
      }
    }
  }
  return children;
}

/** Visits every node with the innermost enclosing function (undefined at the chunk's top level). */
function walk(node, visit, within) {
  visit(node, within);
  const next = node.type === 'FunctionDeclaration' ? node : within;
  for (const child of childNodes(node)) {
    walk(child, visit, next);
  }
}

/** `X.AnimState:PlayAnimation(...)` / `PushAnimation(...)`: the kind and the entity expression X. */
function sinkOf(call) {
  const { base } = call;
  if (
    call.type !== 'CallExpression' ||
    base?.type !== 'MemberExpression' ||
    base.indexer !== ':' ||
    !Object.hasOwn(SINKS, base.identifier.name) ||
    base.base.type !== 'MemberExpression' ||
    base.base.identifier.name !== 'AnimState'
  ) {
    return undefined;
  }
  return { kind: SINKS[base.identifier.name], target: base.base.base };
}

const text = (source, node) => source.slice(...node.range);

function stringValue(node) {
  if (node?.type !== 'StringLiteral') {
    return undefined;
  }
  const raw = node.raw;
  if (!/^(["'])[^\\]*\1$/.test(raw)) {
    return undefined;
  }
  return raw.slice(1, -1);
}

/** The clip names an argument can be: a literal, or `cond and "a" or "b"`. Undefined when it is computed. */
/** Past this many names an expression is reported as computed rather than enumerated. */
const MAX_VALUES = 64;

function union(...lists) {
  if (lists.some(list => list === undefined)) {
    return undefined;
  }
  const values = [...new Set(lists.flat())];
  return values.length <= MAX_VALUES ? values : undefined;
}

/** The return expressions of a function body, not those of functions declared inside it. */
function returnExpressions(node, found = []) {
  for (const child of childNodes(node)) {
    if (child.type === 'FunctionDeclaration') {
      continue;
    }
    if (child.type === 'ReturnStatement') {
      found.push(child.arguments[0]);
    } else {
      returnExpressions(child, found);
    }
  }
  return found;
}

/**
 * Every string an expression can be, or undefined when it cannot be enumerated:
 * - a literal;
 * - `a .. b`, every value of `a` before every value of `b`;
 * - `cond and a or b`, and `a or b`, the values of both;
 * - a parameter bound in `env`;
 * - a `domains` expression such as `TheWorld.state.moonphase`, each value the scenarios give it;
 * - a call of a local function the file declares once, with its arguments bound, the union of its returns.
 */
function evaluate(node, context, env = new Map(), depth = 0) {
  if (!node || depth > 8) {
    return undefined;
  }
  const literal = stringValue(node);
  if (literal !== undefined) {
    return [literal];
  }
  switch (node.type) {
    case 'BinaryExpression': {
      if (node.operator !== '..') {
        return undefined;
      }
      const left = evaluate(node.left, context, env, depth + 1);
      const right = evaluate(node.right, context, env, depth + 1);
      return left && right ? union(left.flatMap(a => right.map(b => a + b))) : undefined;
    }
    case 'LogicalExpression': {
      if (node.operator !== 'or') {
        return undefined;
      }
      const whenTrue =
        node.left.type === 'LogicalExpression' && node.left.operator === 'and'
          ? evaluate(node.left.right, context, env, depth + 1)
          : evaluate(node.left, context, env, depth + 1);
      return union(whenTrue, evaluate(node.right, context, env, depth + 1));
    }
    case 'Identifier':
      return env.get(node.name);
    case 'MemberExpression':
      return context.domains[text(context.source, node)];
    case 'CallExpression': {
      const fn = node.base.type === 'Identifier' ? context.functions.get(node.base.name) : undefined;
      if (!fn) {
        return undefined;
      }
      const bound = new Map();
      for (const [index, parameter] of fn.parameters.entries()) {
        const value = evaluate(node.arguments[index], context, env, depth + 1);
        if (value) {
          bound.set(parameter.name, value);
        }
      }
      const returns = returnExpressions(fn.body ? fn : { body: [] });
      return returns.length
        ? union(...returns.map(expression => evaluate(expression, context, bound, depth + 1)))
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Local functions declared once in the file, by name, for `evaluate` to follow. */
function localFunctions(chunk) {
  const found = new Map();
  const counts = new Map();
  walk(chunk, node => {
    if (node.type === 'FunctionDeclaration' && node.isLocal && node.identifier?.type === 'Identifier') {
      counts.set(node.identifier.name, (counts.get(node.identifier.name) ?? 0) + 1);
      found.set(node.identifier.name, node);
    }
  });
  for (const [name, count] of counts) {
    if (count > 1) {
      found.delete(name);
    }
  }
  return found;
}

function loopValue(node) {
  if (!node) {
    return 'omitted';
  }
  if (node.type === 'BooleanLiteral') {
    return node.value;
  }
  if (node.type === 'NilLiteral') {
    return 'omitted';
  }
  return 'dynamic';
}

function functionName(source, node, names) {
  if (!node) {
    return 'main chunk';
  }
  return names.get(node) ?? (node.identifier ? text(source, node.identifier) : `function@${node.loc.start.line}`);
}

/**
 * Local functions that pass one of their parameters to AnimState:PlayAnimation / PushAnimation as the clip, such as
 * furniture_chairs.lua's `_PlayAnimation(inst, anim, loop)`: by name, the parameter positions and each target
 * expression they play on, in terms of the parameters.
 */
function findWrappers(source, chunk) {
  const wrappers = new Map();
  const counts = new Map();
  walk(chunk, node => {
    if (node.type === 'FunctionDeclaration' && node.isLocal && node.identifier?.type === 'Identifier') {
      counts.set(node.identifier.name, (counts.get(node.identifier.name) ?? 0) + 1);
    }
  });
  walk(chunk, (node, within) => {
    const sink = sinkOf(node);
    if (!sink || !within?.isLocal || within.identifier?.type !== 'Identifier') {
      return;
    }
    const parameters = within.parameters.map(parameter => parameter.name);
    const [clip, loop] = node.arguments;
    const clipIndex = clip?.type === 'Identifier' ? parameters.indexOf(clip.name) : -1;
    if (clipIndex < 0 || counts.get(within.identifier.name) !== 1) {
      return;
    }
    const loopIndex = loop?.type === 'Identifier' ? parameters.indexOf(loop.name) : -1;
    const name = within.identifier.name;
    const wrapper = wrappers.get(name) ?? { name, parameters, sinks: [] };
    wrapper.sinks.push({
      kind: sink.kind,
      clipIndex,
      loopIndex,
      loop: loopIndex < 0 ? loopValue(loop) : undefined,
      target: text(source, sink.target),
    });
    wrappers.set(name, wrapper);
  });
  return wrappers;
}

/** A wrapper target in the caller's terms: its leading parameter name replaced by the argument passed for it. */
function callerTarget(source, wrapper, call, target) {
  const [head, ...rest] = target.split(/(?=[.:[])/);
  const index = wrapper.parameters.indexOf(head);
  if (index < 0) {
    return target;
  }
  const argument = call.arguments[index];
  return argument ? [text(source, argument), ...rest].join('') : target;
}

function assignNames(source, chunk) {
  const names = new Map();
  walk(chunk, node => {
    if (node.type === 'AssignmentStatement' || node.type === 'LocalStatement') {
      node.init.forEach((init, index) => {
        if (init.type === 'FunctionDeclaration' && node.variables[index]) {
          names.set(init, text(source, node.variables[index]));
        }
      });
    } else if (node.type === 'TableConstructorExpression') {
      // A stategraph State{ name = "hit", onenter = function ... }: its functions are named for their state.
      const named = node.fields.find(field => field.type === 'TableKeyString' && field.key.name === 'name');
      const state = stringValue(named?.value);
      for (const field of node.fields) {
        if (field.type === 'TableKeyString' && field.value.type === 'FunctionDeclaration') {
          names.set(field.value, state === undefined ? field.key.name : `${state}.${field.key.name}`);
        }
      }
    }
  });
  return names;
}

/**
 * Every AnimState:PlayAnimation / PushAnimation the source makes, directly or through a local wrapper: each clip the
 * argument can be (see `evaluate`; the expression itself when it cannot be enumerated), play or push, the loop argument
 * (true, false, 'omitted' or 'dynamic'), the entity expression it plays on, and where. `range` limits the scan to one
 * function's lines, for a callback another file defines. `domains` gives the values of world-state expressions, such as
 * `TheWorld.state.moonphase`. A `CommonStates.Add*` call, whose clips commonstates.lua plays, is listed as computed.
 */
export function scanClipPlays(source, file, range, { domains = {} } = {}) {
  const chunk = parse(source);
  const names = assignNames(source, chunk);
  const wrappers = findWrappers(source, chunk);
  const context = { source, domains, functions: localFunctions(chunk) };
  const plays = [];
  const inRange = node => !range || (node.loc.start.line >= range.startLine && node.loc.end.line <= range.endLine);
  const push = (node, within, entry, clip) => {
    const values = evaluate(clip, context);
    const at = { file, line: node.loc.start.line, within: functionName(source, within, names) };
    if (values) {
      for (const value of values) {
        plays.push({ clip: value, ...entry, ...at });
      }
    } else {
      plays.push({ dynamic: clip ? text(source, clip) : 'nil', ...entry, ...at });
    }
  };
  walk(chunk, (node, within) => {
    if (node.type !== 'CallExpression' || !inRange(node)) {
      return;
    }
    // commonstates.lua builds states from the clip names it is given; its own plays are not followed.
    if (
      node.base.type === 'MemberExpression' &&
      node.base.base.type === 'Identifier' &&
      node.base.base.name === 'CommonStates'
    ) {
      plays.push({
        dynamic: text(source, node.base),
        kind: 'commonstates',
        loop: 'dynamic',
        target: 'inst',
        file,
        line: node.loc.start.line,
        within: functionName(source, within, names),
      });
      return;
    }
    const sink = sinkOf(node);
    if (sink) {
      const [clip, loop] = node.arguments;
      // A wrapper's own forwarding call is reported at each of its call sites instead.
      if (within && wrappers.get(within.identifier?.name)?.sinks.length && clip?.type === 'Identifier') {
        return;
      }
      push(node, within, { kind: sink.kind, loop: loopValue(loop), target: text(source, sink.target) }, clip);
      return;
    }
    const wrapper = node.base.type === 'Identifier' ? wrappers.get(node.base.name) : undefined;
    if (!wrapper) {
      return;
    }
    for (const forwarded of wrapper.sinks) {
      const loop = forwarded.loopIndex < 0 ? forwarded.loop : loopValue(node.arguments[forwarded.loopIndex]);
      push(
        node,
        within,
        {
          kind: forwarded.kind,
          loop,
          target: callerTarget(source, wrapper, node, forwarded.target),
          via: wrapper.name,
        },
        node.arguments[forwarded.clipIndex],
      );
    }
  });
  return plays.sort((a, b) => a.line - b.line || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

/** Transform:SetNoFaced / SetFourFaced / SetEightFaced: the facings each referenced clip must cover. */
export const FACE_MODES = {
  1: [],
  4: ['right', 'up', 'left', 'down'],
  8: ['right', 'up', 'left', 'down', 'upright', 'upleft', 'downright', 'downleft'],
};

/**
 * The clip table a schema carries for one bank, from the plays the prefab's Lua makes and the bank's anim.bin:
 * - `clips`: every clip in the bank, by name, with the facings its entries cover and their frame count (one number when
 *   every entry has the same count), whether or not the Lua plays it;
 * - `clipsNotInBank`: clips the Lua plays that the bank lacks, with where they are played in line order (branches of other prefabs in
 *   a shared file, or a missing asset);
 * - `dynamicClips`: plays whose clip is computed, for a reader to resolve.
 * A referenced clip the bank has must cover the facings the Transform face mode needs; otherwise this throws.
 */
export function clipCatalog({ plays, bankClips, facings }) {
  const required = FACE_MODES[facings];
  if (!required) {
    throw new Error(`Unsupported face mode: ${facings}`);
  }
  const clips = {};
  for (const name of [...bankClips.keys()].sort()) {
    const { facings: mask, entries } = bankClips.get(name);
    const counts = [...new Set(entries.map(entry => entry.frames))];
    clips[name] = {
      name,
      facings: facingNames(mask),
      frames:
        counts.length === 1
          ? counts[0]
          : Object.fromEntries(entries.map(entry => [facingNames(entry.facing).join('+'), entry.frames])),
    };
  }
  const notInBank = new Map();
  for (const play of plays) {
    if (play.clip === undefined) {
      continue;
    }
    const clip = clips[play.clip];
    if (!clip) {
      const where = notInBank.get(play.clip) ?? new Set();
      where.add(`${play.file}:${play.line} ${play.within}`);
      notInBank.set(play.clip, where);
      continue;
    }
    const missing = required.filter(facing => !clip.facings.includes(facing));
    if (missing.length) {
      throw new Error(
        `${play.file}:${play.line} plays ${play.clip}, which covers ${clip.facings.join(', ')} but not ${missing.join(', ')}`,
      );
    }
  }
  return {
    clips,
    clipsNotInBank: Object.fromEntries(
      [...notInBank].sort(([a], [b]) => (a < b ? -1 : 1)).map(([clip, where]) => [clip, [...where]]),
    ),
    dynamicClips: plays
      .filter(play => play.dynamic !== undefined)
      .map(({ dynamic, file, line, within }) => ({ expression: dynamic, at: `${file}:${line} ${within}` })),
  };
}
