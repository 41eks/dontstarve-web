import { facingNames } from './anim-bin.mjs';
import { childNodes, FALSE, LuaEvaluator, NIL, parseLua as parse, stringValue, TRUE, UNKNOWN } from './lua-eval.mjs';

const SINKS = { PlayAnimation: 'play', PushAnimation: 'push' };
const COMMONSTATES = 'stategraphs/commonstates.lua';

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

/** `CommonStates.AddX(...)`: the name of the commonstates.lua builder it calls. */
function commonStatesCall(call) {
  const { base } = call;
  return call.type === 'CallExpression' &&
    base.type === 'MemberExpression' &&
    base.indexer === '.' &&
    base.base.type === 'Identifier' &&
    base.base.name === 'CommonStates'
    ? base.identifier.name
    : undefined;
}

const text = (source, node) => source.slice(...node.range);

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

/** One play per clip name the argument can be, and one computed entry when it can also be anything but a name or nil. */
function playsOf(atoms, expression, entry) {
  const plays = atoms.filter(atom => typeof atom === 'string').map(clip => ({ clip, ...entry }));
  if (atoms.some(atom => typeof atom !== 'string' && atom !== NIL)) {
    plays.push({ dynamic: expression, ...entry });
  }
  return plays;
}

/** A loop argument's atoms: true, false, 'omitted' (nil), or 'dynamic' when they differ or are unknown. */
function loopOf(atoms) {
  if (atoms.every(atom => atom === TRUE)) {
    return true;
  }
  if (atoms.every(atom => atom === FALSE)) {
    return false;
  }
  return atoms.every(atom => atom === NIL) ? 'omitted' : 'dynamic';
}

/**
 * commonstates.lua's builders (`CommonStates.AddX = function(states, ...)`), expanded with the arguments a stategraph
 * passes: the plays in the builder and its state functions, with its parameters bound and its locals evaluated; in the
 * file's local functions it references (a state's `onenter = onentersleeping`, a call of `onenterfrozenpre(inst)`),
 * whose parameters the engine passes; and in the builders it calls in turn.
 */
class CommonStatesScanner {
  constructor(source) {
    this.source = source;
    this.chunk = parse(source);
    this.evaluator = new LuaEvaluator(source, this.chunk);
    this.top = this.evaluator.scope(this.chunk, new Map());
    this.builders = new Map();
    walk(this.chunk, node => {
      if (node.type !== 'AssignmentStatement') {
        return;
      }
      node.variables.forEach((variable, index) => {
        const init = node.init[index];
        if (
          init?.type === 'FunctionDeclaration' &&
          variable.type === 'MemberExpression' &&
          variable.base.type === 'Identifier' &&
          variable.base.name === 'CommonStates'
        ) {
          this.builders.set(variable.identifier.name, init);
        }
      });
    });
  }

  expand(name, args, depth = 0) {
    const builder = this.builders.get(name);
    if (!builder || depth > 4) {
      return [{ dynamic: `CommonStates.${name}`, kind: 'commonstates', loop: 'dynamic', target: 'inst' }];
    }
    const env = this.evaluator.scope(builder, this.evaluator.bind(builder, args, this.top), 0, true);
    const plays = [];
    this.collect(builder, env, plays, depth, new Set([builder]), name);
    return plays;
  }

  collect(fn, env, plays, depth, seen, builder) {
    const via = `CommonStates.${builder}`;
    for (const body of childNodes(fn)) {
      walk(body, node => {
        const sink = node.type === 'CallExpression' ? sinkOf(node) : undefined;
        if (sink) {
          const [clip, loop] = node.arguments;
          const entry = {
            kind: sink.kind,
            loop: loopOf(this.evaluator.evaluate(loop, env)),
            target: text(this.source, sink.target),
            via,
            source: `${COMMONSTATES}:${node.loc.start.line}`,
          };
          plays.push(...playsOf(this.evaluator.evaluate(clip, env), clip ? text(this.source, clip) : 'nil', entry));
          return;
        }
        const nested = node.type === 'CallExpression' ? commonStatesCall(node) : undefined;
        if (nested) {
          const args = node.arguments.map(argument => this.evaluator.evaluate(argument, env));
          plays.push(...this.expand(nested, args, depth + 1));
          return;
        }
        const referenced = node.type === 'Identifier' && !env.has(node.name) && this.evaluator.functions.get(node.name);
        if (referenced && !seen.has(referenced)) {
          seen.add(referenced);
          const unknown = referenced.parameters.map(() => [UNKNOWN]);
          const scope = this.evaluator.scope(referenced, this.evaluator.bind(referenced, unknown, this.top), 0, true);
          this.collect(referenced, scope, plays, depth, seen, builder);
        }
      });
    }
  }
}

const commonStatesScanners = new WeakMap();

function commonStatesScanner(readSource) {
  let scanner = commonStatesScanners.get(readSource);
  if (!scanner) {
    scanner = new CommonStatesScanner(readSource(COMMONSTATES));
    commonStatesScanners.set(readSource, scanner);
  }
  return scanner;
}

/**
 * Every AnimState:PlayAnimation / PushAnimation the source makes, directly or through a local wrapper: each clip the
 * argument can be (see LuaEvaluator; the expression itself when it can also be something else), play or push, the loop
 * argument (true, false, 'omitted' or 'dynamic'), the entity expression it plays on, and where. `range` limits the scan
 * to one function's lines, for a callback another file defines. `domains` gives the values of world-state expressions,
 * such as `TheWorld.state.moonphase`. With `readSource`, a `CommonStates.AddX(...)` call is expanded into the plays of
 * that commonstates.lua builder with the call's arguments (`via` and `source` say where); without it, the call is
 * listed as computed.
 */
export function scanClipPlays(source, file, range, { domains = {}, readSource } = {}) {
  const chunk = parse(source);
  const names = assignNames(source, chunk);
  const wrappers = findWrappers(source, chunk);
  const evaluator = new LuaEvaluator(source, chunk, { domains });
  const top = evaluator.scope(chunk, new Map());
  const plays = [];
  const inRange = node => !range || (node.loc.start.line >= range.startLine && node.loc.end.line <= range.endLine);
  const push = (node, within, entry, clip) => {
    const at = { file, line: node.loc.start.line, within: functionName(source, within, names) };
    plays.push(...playsOf(evaluator.evaluate(clip, top), clip ? text(source, clip) : 'nil', { ...entry, ...at }));
  };
  walk(chunk, (node, within) => {
    if (node.type !== 'CallExpression' || !inRange(node)) {
      return;
    }
    const builder = commonStatesCall(node);
    if (builder) {
      const at = { file, line: node.loc.start.line, within: functionName(source, within, names) };
      const expanded = readSource
        ? commonStatesScanner(readSource).expand(
            builder,
            node.arguments.map(argument => evaluator.evaluate(argument, top)),
          )
        : [{ dynamic: `CommonStates.${builder}`, kind: 'commonstates', loop: 'dynamic', target: 'inst' }];
      plays.push(...expanded.map(play => ({ ...play, ...at })));
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
