#!/usr/bin/env node
/**
 * Mechanical checks for the rules in AGENTS.md and the package AGENTS.md files that a syntax tree can decide.
 *
 *   node scripts/check-conventions.mjs [paths...]          list violations by file, then a summary
 *     --rule a,b         only these rules            --level error|review   only this level
 *     --summary          counts only                 --json                 machine-readable output
 *     --baseline FILE    exit 1 only where a file has more violations of a rule than FILE records (a ratchet)
 *     --write-baseline FILE   record the current counts
 *     --root DIR         check another tree laid out like this repository (the script's tests use it)
 *
 * `error` rules are violations as written; `review` rules are heuristics a person decides on (for instance a closure the
 * Lua source also writes). A line, or the line before it, may carry `// conventions-allow <rule>[, <rule>]: <reason>`.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

let ROOT = resolve(new URL('..', import.meta.url).pathname);

/** Where each group of rules applies, as path prefixes relative to the repository root. */
const PREFAB = ['packages/prefab/src/'];
const LOGIC = ['packages/prefab/src/', 'packages/componets/src/', 'packages/brains/src/', 'packages/behaviours/src/',
  'packages/stategraphs/src/', 'src/'];
const SOURCES = [...LOGIC, 'packages/display/src/', 'packages/animation/src/', 'packages/inventory/src/', 'packages/ui/src/',
  'packages/map/src/', 'packages/signals/src/', 'packages/sound/src/'];
const TESTS = ['packages/'];

const RULES = {
  'components-write': { level: 'error', scope: SOURCES, doc: 'AGENTS.md, packages/prefab/AGENTS.md#components',
    message: 'writes inst.components directly; use addComponent / removeComponent' },
  'object-assign-state': { level: 'error', scope: [...LOGIC, 'packages/inventory/src/'], doc: 'AGENTS.md#cross-package-ownership',
    message: 'Object.assign into an existing object; write through its owner (setter, method, addComponent)' },
  'component-dispose-on-remove': { level: 'error', scope: PREFAB, doc: 'packages/prefab/AGENTS.md#components',
    message: 'disposes a component in onRemove; addComponent already tears it down on removal' },
  'userdata': { level: 'error', scope: LOGIC, doc: 'packages/prefab/docs/instance-ownership.md',
    message: 'uses model.userData as entity data; read and write the instance and its components' },
  'scene': { level: 'error', scope: PREFAB, doc: 'packages/prefab/docs/instance-ownership.md',
    message: 'holds or reaches the scene; the display layer mounts entities' },
  'model-keyed-state': { level: 'error', scope: LOGIC, doc: 'packages/prefab/AGENTS.md#prefab-callbacks',
    message: 'keeps state keyed by a model; keep it on the instance (inst._field) or its component' },
  'manager': { level: 'error', scope: PREFAB, doc: 'packages/prefab/AGENTS.md#prefab-porting-requirements',
    message: 'a prefab-specific manager; register prefabs on the shared PrefabEntityManager' },
  'manager-prefab-branch': { level: 'error', scope: ['packages/prefab/src/prefabInstance.ts'],
    doc: 'packages/prefab/AGENTS.md#prefab-porting-requirements',
    message: 'PrefabEntityManager branches on a prefab ID; declare the difference on PrefabEntityDefinition' },
  'instance-method': { level: 'review', scope: PREFAB, doc: 'packages/prefab/AGENTS.md#prefab-callbacks',
    message: 'behaviour on a PrefabInstance subclass; Lua local functions are module functions of inst, registered in fn' },
  'sg-forward': { level: 'error', scope: ['packages/prefab/src/', 'packages/componets/src/', 'src/'],
    doc: 'packages/prefab/docs/lua-api-map.md',
    message: 'pushes to a stategraph directly; inst:PushEvent forwards to inst.sg when it listens' },
  'prefab-timer': { level: 'review', scope: PREFAB, doc: 'packages/prefab/docs/lua-api-map.md',
    message: 'a hand-made timer; use inst.DoTaskInTime / DoPeriodicTask, which Remove cancels' },
  // sound.ts owns FEV event playback and its loading (AGENTS.md's package table).
  'prefab-io': { level: 'error', scope: PREFAB, except: ['packages/prefab/src/sound.ts'], doc: 'packages/prefab/docs/display-declarations.md',
    message: 'loads or awaits in prefab logic; declare art by name and let the display load it' },
  'model-events': { level: 'error', scope: [...PREFAB, 'packages/componets/src/'], doc: 'packages/prefab/docs/instance-ownership.md',
    message: 'game events on a three.js object; use inst:PushEvent / ListenForEvent' },
  'child-traversal': { level: 'review', scope: PREFAB, doc: 'packages/prefab/docs/instance-ownership.md',
    message: 'walks the model tree; read logical state from the instance, display state through prefabDisplay()' },
  'prefab-id-branch': { level: 'review', scope: ['packages/stategraphs/src/', 'packages/componets/src/', 'packages/brains/src/',
    'packages/behaviours/src/', 'src/'], doc: 'packages/stategraphs/AGENTS.md',
    message: 'branches on a prefab ID outside its prefab; use tags and components (unless the Lua component does the same)' },
  'page-lifecycle': { level: 'error', scope: SOURCES, doc: 'AGENTS.md#page-lifecycle',
    message: 'cleanup on page departure; the page needs no disposal when it is left' },
  'skipped-test': { level: 'error', scope: TESTS, doc: 'AGENTS.md#representative-tests',
    message: 'a skipped or todo test; remove obsolete tests instead' },
};

const THREE_TREE_EVENTS = new Set(['added', 'removed', 'childadded', 'childremoved']);
/** Browser input and physics-body events, which are not game events on a model. */
const HOST_EVENTS = /^(pointer|mouse|key|touch|wheel|click|dblclick|contextmenu|resize|focus|blur|visibilitychange|collide|preStep|postStep)/;
const LOADERS = new Set(['createArchiveSprite', 'loadBuild', 'loadAnimation', 'loadAnimationArchive', 'loadSpriteSkinArchive',
  'loadBuildArchive', 'fetch', 'preloadSharedArchiveSprite', 'createAnimatedSprite']);
const MODEL_TYPES = /(^|\.)(Group|Object3D|Mesh|Scene)$/;

function parseArgs(argv) {
  const options = { paths: [], rules: undefined, level: undefined, json: false, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rule') options.rules = new Set(argv[++i].split(','));
    else if (arg === '--level') options.level = argv[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--baseline') options.baseline = argv[++i];
    else if (arg === '--write-baseline') options.writeBaseline = argv[++i];
    else if (arg === '--root') options.root = resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.paths.push(arg);
  }
  for (const rule of options.rules ?? []) if (!RULES[rule]) throw new Error(`Unknown rule ${rule}`);
  return options;
}

function listFiles(start) {
  const out = [];
  const walk = path => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        walk(join(path, name));
      }
    } else if (/\.(ts|mts|tsx)$/.test(path) && !path.endsWith('.d.ts')) out.push(path);
  };
  walk(start);
  return out;
}

const inScope = (file, scope, except = []) => scope.some(prefix => file === prefix || file.startsWith(prefix)) && !except.includes(file);
const isTest = file => /\/tests\//.test(file) || /\.(test|spec)\.ts$/.test(file);

/** `// conventions-allow a, b: reason` on the line or the line before. */
function allowances(text) {
  const allowed = new Map();
  text.split('\n').forEach((line, index) => {
    const match = /conventions-allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)/.exec(line);
    if (!match) return;
    const rules = match[1].split(',').map(rule => rule.trim());
    for (const at of [index + 1, index + 2]) allowed.set(at, [...allowed.get(at) ?? [], ...rules]);
  });
  return allowed;
}

/** Class name → base class name, across all scanned files, to find PrefabInstance subclasses by name. */
function prefabInstanceClasses(sources) {
  const bases = new Map();
  for (const source of sources) {
    ts.forEachChild(source, function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
        if (heritage) bases.set(node.name.text, heritage.expression.getText(source).replace(/^.*\./, ''));
      }
      ts.forEachChild(node, visit);
    });
  }
  const result = new Set(['PrefabInstance', 'ItemEntity']);
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, base] of bases) if (!result.has(name) && result.has(base)) { result.add(name); changed = true; }
  }
  result.delete('PrefabInstance');
  return result;
}

const calleeName = call => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text
  : ts.isIdentifier(call.expression) ? call.expression.text : undefined;
const receiverText = (call, source) => ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(source) : '';
const isComponentsAccess = node => ts.isPropertyAccessExpression(node) && node.name.text === 'components';
const stripParens = node => { while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) node = node.expression; return node; };

/** `name` is a local of the enclosing function initialised with a new object, so assigning into it still builds it. */
function isLocalNewObject(node, name) {
  let scope = node.parent;
  while (scope && !(ts.isFunctionLike(scope) && scope.body) && !ts.isSourceFile(scope)) scope = scope.parent;
  let found = false;
  (scope?.body ?? scope)?.forEachChild(function find(child) {
    if (found) return;
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === name && child.initializer) {
      const init = stripParens(child.initializer);
      found = ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init) || ts.isNewExpression(init);
    }
    if (!ts.isFunctionLike(child)) child.forEachChild(find);
  });
  return found;
}

/** `node` (or, unless `exact`, a member path below it) is written: assigned, deleted, incremented or Object.assign's target. */
function isAssignmentTarget(node, exact = false) {
  let child = node, parent = node.parent;
  while (!exact && parent && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === child) {
    child = parent; parent = parent.parent;
  }
  if (!parent) return false;
  if (ts.isBinaryExpression(parent) && parent.left === child
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if (ts.isDeleteExpression(parent)) return true;
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === child && parent.expression.getText() === 'Object.assign') return true;
  return false;
}

function check(file, source, prefabClasses, report) {
  const text = source.getFullText();
  const at = node => source.getLineAndCharacterOfPosition(node.getStart(source));
  const add = (rule, node, detail) => {
    if (!inScope(file, RULES[rule].scope, RULES[rule].except)) return;
    if (rule !== 'skipped-test' && isTest(file)) return;
    const { line, character } = at(node);
    report({ file, line: line + 1, column: character + 1, rule, level: RULES[rule].level,
      message: RULES[rule].message + (detail ? ` (${detail})` : '') });
  };
  if (/\/(tests)\//.test(file)) {
    ts.forEachChild(source, function visit(node) {
      if (ts.isPropertyAccessExpression(node) && /^(it|test|describe)$/.test(node.expression.getText(source))
        && /^(skip|todo|skipIf)$/.test(node.name.text)) add('skipped-test', node, node.getText(source));
      ts.forEachChild(node, visit);
    });
    return;
  }

  const visit = (node, context) => {
    // components-write
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'Object.assign' && node.arguments.length) {
      const target = stripParens(node.arguments[0]);
      if (isComponentsAccess(target)) add('components-write', node, 'Object.assign(…components, …)');
      // A new object, the object's own state (this.x) and DOM styles are not another owner's state.
      else if (!ts.isObjectLiteralExpression(target) && !ts.isArrayLiteralExpression(target) && !ts.isNewExpression(target)
        && !ts.isCallExpression(target) && !/^this\./.test(target.getText(source)) && !/\.style$/.test(target.getText(source))
        && !(ts.isIdentifier(target) && isLocalNewObject(node, target.text))) {
        add('object-assign-state', node, `Object.assign(${target.getText(source).slice(0, 40)}, …)`);
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isComponentsAccess(stripParens(node.expression))
      && file !== 'packages/prefab/src/components.ts' && isAssignmentTarget(node, true)
      && !(ts.isCallExpression(node.parent) && node.parent.expression.getText(source) === 'Object.assign')) {
      add('components-write', node, node.getText(source).slice(0, 60));
    }
    // userdata: reads and writes, userData.tags included (tags live on the instance).
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'userData') {
      const parent = node.parent;
      const member = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : undefined;
      add('userdata', node, `${isAssignmentTarget(node) ? 'writes' : 'reads'} userData${member ? `.${member}` : ''}`);
    }
    // scene
    if ((ts.isPropertyAccessExpression(node) && node.name.text === 'scene')
      || ((ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.name?.getText(source) === 'scene')
      || (ts.isTypeReferenceNode(node) && /(^|\.)Scene$/.test(node.typeName.getText(source))
        && !((ts.isParameter(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertySignature(node.parent))
          && node.parent.name?.getText(source) === 'scene'))) {
      add('scene', node, node.getText(source).slice(0, 50));
    }
    // model-keyed-state
    const keyed = (name, args) => /^(WeakMap|Map|WeakSet|Set)$/.test(name) && args?.length && MODEL_TYPES.test(args[0].getText(source));
    if (ts.isNewExpression(node) && keyed(node.expression.getText(source), node.typeArguments)) add('model-keyed-state', node, node.getText(source).slice(0, 60));
    else if (ts.isTypeReferenceNode(node) && keyed(node.typeName.getText(source), node.typeArguments)
      && !(ts.isNewExpression(node.parent))) add('model-keyed-state', node, node.getText(source).slice(0, 60));
    // manager
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text, base = node.heritageClauses?.[0]?.types[0]?.expression.getText(source) ?? '';
      if ((/Manager$/.test(name) && name !== 'PrefabEntityManager') || /(^|\.)PrefabEntityManager$/.test(base)) add('manager', node.name, name);
    }
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'PrefabEntityManager') add('manager', node, 'new PrefabEntityManager in a prefab module');
    // manager-prefab-branch
    if (context.managerClass && (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind))) {
      const sides = [node.left, node.right];
      if (sides.some(side => ts.isStringLiteral(side)) && sides.some(side => /prefab/i.test(side.getText(source)))) add('manager-prefab-branch', node, node.getText(source));
    }
    // instance-method
    if (context.prefabClass && node.parent === context.prefabClass) {
      const fieldFunction = ts.isPropertyDeclaration(node) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
      if ((ts.isMethodDeclaration(node) && node.body) || fieldFunction) {
        add('instance-method', node.name, `${context.prefabClass.name?.text}.${node.name.getText(source)}`);
      }
    }
    // sg-forward
    if (ts.isCallExpression(node) && calleeName(node) === 'pushEvent' && /(^|\.|\?)(sg|stategraph)\??$/.test(receiverText(node, source).replace(/!$/, ''))) {
      add('sg-forward', node, node.getText(source).slice(0, 60));
    }
    // prefab-timer
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'ComponentTimer') add('prefab-timer', node, 'new ComponentTimer');
    if (ts.isCallExpression(node) && calleeName(node) === 'schedule' && /scheduler/i.test(receiverText(node, source))) add('prefab-timer', node, node.getText(source).slice(0, 50));
    // prefab-io
    if (ts.isAwaitExpression(node)) add('prefab-io', node, 'await');
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) add('prefab-io', node, 'async function');
    if (ts.isCallExpression(node) && (calleeName(node) === 'then' || LOADERS.has(calleeName(node) ?? ''))) add('prefab-io', node, `${calleeName(node)}()`);
    // model-events
    if (ts.isCallExpression(node) && calleeName(node) === 'dispatchEvent' && !/^(window|document|globalThis)$/.test(receiverText(node, source))) {
      add('model-events', node, 'dispatchEvent');
    }
    if (ts.isCallExpression(node) && calleeName(node) === 'addEventListener' && ts.isStringLiteral(node.arguments[0] ?? node)
      && !THREE_TREE_EVENTS.has(node.arguments[0].text) && !HOST_EVENTS.test(node.arguments[0].text)
      ) add('model-events', node, `addEventListener('${node.arguments[0].text}')`);
    // page-lifecycle
    if (ts.isCallExpression(node) && calleeName(node) === 'addEventListener' && ts.isStringLiteral(node.arguments[0] ?? node)
      && ['pagehide', 'beforeunload', 'unload'].includes(node.arguments[0].text)) add('page-lifecycle', node, node.arguments[0].text);
    if (ts.isPropertyAccessExpression(node) && ['onbeforeunload', 'onpagehide', 'onunload'].includes(node.name.text) && isAssignmentTarget(node)) add('page-lifecycle', node, node.name.text);
    // child-traversal
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'children' && !isAssignmentTarget(node)
      && /(model|group|object|root|mesh|visual|sprite|parent|node)\??$/i.test(node.expression.getText(source))) add('child-traversal', node, node.getText(source).slice(0, 50));
    if (ts.isCallExpression(node) && /^(traverse|traverseVisible|getObjectByProperty|getObjectsByProperty|getObjectByName)$/.test(calleeName(node) ?? '')) add('child-traversal', node, `${calleeName(node)}()`);
    // prefab-id-branch
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      const sides = [node.left, node.right].map(stripParens);
      const literal = sides.find(side => ts.isStringLiteral(side));
      const other = sides.find(side => side !== literal);
      // TheWorld.prefab (forest / cave) is the world's kind, not an entity's prefab.
      if (literal && other && !ts.isTypeOfExpression(other) && /(^|\.)(prefab|prefabId|prefabName)$/.test(other.getText(source))
        && !/(^|\.)world\??\.prefab$/i.test(other.getText(source))) add('prefab-id-branch', node, node.getText(source).slice(0, 60));
    }
    if (ts.isSwitchStatement(node) && /(^|\.)(prefab|prefabId)$/.test(node.expression.getText(source))) add('prefab-id-branch', node, `switch (${node.expression.getText(source)})`);

    // component-dispose-on-remove: X.dispose() on a component inside an onRemove callback.
    if (ts.isCallExpression(node) && calleeName(node) === 'onRemove' && node.arguments[0]
      && (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
      const components = context.componentVariables;
      node.arguments[0].body.forEachChild(function inner(child) {
        if (ts.isCallExpression(child) && calleeName(child) === 'dispose') {
          const receiver = stripParens(child.expression.expression ?? child.expression);
          const receiverName = receiver.getText(source).replace(/\?$/, '');
          if (/\.components\.\w+\??$/.test(receiverName) || components.has(receiverName)) add('component-dispose-on-remove', child, child.getText(source).slice(0, 60));
        }
        child.forEachChild(inner);
      });
    }

    let next = context;
    if (ts.isClassDeclaration(node) && node.name) {
      next = { ...context, prefabClass: prefabClasses.has(node.name.text) ? node : undefined, managerClass: node.name.text === 'PrefabEntityManager' };
    }
    if (ts.isFunctionLike(node) && node.body) {
      // Variables holding what addComponent returned in this function, for component-dispose-on-remove.
      const componentVariables = new Set(context.componentVariables);
      node.body.forEachChild?.(function find(child) {
        if (ts.isVariableDeclaration(child) && child.initializer && ts.isCallExpression(stripParens(child.initializer))
          && calleeName(stripParens(child.initializer)) === 'addComponent' && ts.isIdentifier(child.name)) componentVariables.add(child.name.text);
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isCallExpression(stripParens(child.right))
          && calleeName(stripParens(child.right)) === 'addComponent') componentVariables.add(child.left.getText(source));
        if (!ts.isFunctionLike(child)) child.forEachChild(find);
      });
      next = { ...next, componentVariables };
    }
    ts.forEachChild(node, child => visit(child, next));
  };
  visit(source, { componentVariables: new Set() });
  return text;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.root) ROOT = options.root;
  const starts = options.paths.length ? options.paths.map(path => resolve(path)) : [join(ROOT, 'packages'), join(ROOT, 'src')];
  const files = [...new Set(starts.filter(existsSync).flatMap(listFiles))].map(path => relative(ROOT, path)).sort();
  const sources = files.map(file => ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true));
  const prefabClasses = prefabInstanceClasses(sources.filter(source => inScope(source.fileName, PREFAB)));
  const violations = [];
  sources.forEach(source => {
    const allowed = allowances(source.getFullText());
    check(source.fileName, source, prefabClasses, violation => {
      if (allowed.get(violation.line)?.includes(violation.rule)) return;
      if (options.rules && !options.rules.has(violation.rule)) return;
      if (options.level && violation.level !== options.level) return;
      violations.push(violation);
    });
  });

  const counts = {};
  for (const { file, rule } of violations) ((counts[file] ??= {})[rule] = (counts[file][rule] ?? 0) + 1);
  if (options.writeBaseline) {
    const sorted = Object.fromEntries(Object.keys(counts).sort().map(file =>
      [file, Object.fromEntries(Object.keys(counts[file]).sort().map(rule => [rule, counts[file][rule]]))]));
    writeFileSync(options.writeBaseline, JSON.stringify(sorted, null, 2) + '\n');
  }

  let shown = violations, failed = false;
  if (options.baseline) {
    const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
    const grown = new Set();
    for (const [file, rules] of Object.entries(counts)) {
      for (const [rule, count] of Object.entries(rules)) if (count > (baseline[file]?.[rule] ?? 0)) grown.add(`${file}\u0000${rule}`);
    }
    shown = violations.filter(({ file, rule }) => grown.has(`${file}\u0000${rule}`));
    failed = shown.length > 0;
  }

  if (options.json) {
    console.log(JSON.stringify({ violations: shown, counts }, null, 2));
  } else {
    if (!options.summary) {
      let current;
      for (const violation of shown) {
        if (violation.file !== current) { current = violation.file; console.log(`\n${current}`); }
        console.log(`  ${String(violation.line).padStart(5)}:${String(violation.column).padEnd(3)} ${violation.level.padEnd(6)} ${violation.rule.padEnd(28)} ${violation.message}`);
      }
    }
    const byRule = {};
    for (const { rule, file } of violations) { const entry = byRule[rule] ??= { count: 0, files: new Set() }; entry.count++; entry.files.add(file); }
    console.log('\nrule                          level    count  files  source');
    for (const [rule, { level, doc }] of Object.entries(RULES)) {
      const entry = byRule[rule];
      if (!entry && options.rules && !options.rules.has(rule)) continue;
      console.log(`${rule.padEnd(30)}${level.padEnd(9)}${String(entry?.count ?? 0).padStart(5)}  ${String(entry?.files.size ?? 0).padStart(5)}  ${doc}`);
    }
    if (options.baseline) console.log(failed ? `\n${shown.length} violation(s) above the baseline in ${options.baseline}` : `\nNo violations above the baseline in ${options.baseline}`);
  }
  if (failed) process.exitCode = 1;
}

main();
