import { isDeepStrictEqual } from 'node:util';

import ts from 'typescript';

const instance = 'StickHeadInstance';

// Contracts belong to registration sites. The recorded function identity links each
// contract to the actual declaration, including when the Lua function is renamed.
const registrations = [
  {
    target: 'components.workable',
    name: 'onfinish',
    kind: 'write',
    parameters: [instance, 'Parameters<WorkableOnFinishFn<StickHeadInstance>>[1]'],
    returnType: 'void',
  },
  {
    target: 'components.workable',
    name: 'SetOnWorkCallback',
    kind: 'call',
    parameters: [
      instance,
      'Parameters<WorkableOnWorkFn<StickHeadInstance>>[1]',
      'Parameters<WorkableOnWorkFn<StickHeadInstance>>[2]',
      'Parameters<WorkableOnWorkFn<StickHeadInstance>>[3]',
    ],
    returnType: 'void',
  },
  {
    target: 'inst',
    name: 'WatchWorldState',
    kind: 'call',
    state: 'isfullmoon',
    parameters: [instance, 'boolean'],
    returnType: 'void',
  },
  { target: 'inst', name: 'OnSave', kind: 'write', parameters: [instance, 'EntityPersistData'], returnType: 'void' },
  { target: 'inst', name: 'OnLoad', kind: 'write', parameters: [instance, 'EntityPersistData'], returnType: 'void' },
  {
    target: 'components.hauntable',
    name: 'SetOnHauntFn',
    kind: 'call',
    parameters: [instance, 'Haunter'],
    returnType: 'boolean',
  },
];

const staticContracts = new Map([
  ['DoTaskInTime', { parameters: [instance], returnType: 'void' }],
  ['Prefab', { parameters: [], returnType: instance }],
]);

// create_common is an internal helper with the same entity type as both factories.
const commonFactory = { parameters: ['string'], returnType: instance };

const typeImports = [
  ['Haunter', '../../../componets/src/hauntable'],
  ['WorkableOnFinishFn', '../../../componets/src/workable'],
  ['WorkableOnWorkFn', '../../../componets/src/workable'],
  ['EntityPersistData', '../saveRecord'],
  [instance, '../stickheads'],
];

function sourceKey({ file, startLine, startColumn }) {
  return `${file}:${startLine}:${startColumn}`;
}

function registeredTypes(snapshots, registrations) {
  const contracts = new Map();
  for (const { recordings } of snapshots) {
    for (const { entity, operations } of recordings) {
      for (const operation of operations) {
        if (operation.entity !== entity) {
          continue;
        }
        const rule = registrations.find(
          ({ target, name, kind, state }) =>
            operation.target === target &&
            operation.name === name &&
            operation.kind === kind &&
            (state === undefined || operation.args[0] === state),
        );
        if (!rule) {
          continue;
        }
        const callback = operation.args[rule.state === undefined ? 0 : 1];
        if (callback?.kind !== 'callback') {
          continue;
        }
        const key = sourceKey(callback);
        const { parameters, returnType } = rule;
        const previous = contracts.get(key);
        const contract = { parameters: parameters.slice(0, callback.parameters.length), returnType };
        if (previous && !isDeepStrictEqual(previous, contract)) {
          throw new Error(`Conflicting callback contracts for ${callback.name ?? 'function'} at ${key}`);
        }
        contracts.set(key, contract);
      }
    }
  }
  return contracts;
}

function uniqueIdentifier(name, used) {
  let identifier = name;
  while (used.has(identifier) || ts.stringToToken(identifier) !== undefined) {
    identifier = '_' + identifier;
  }
  used.add(identifier);
  return identifier;
}

export function prefabFunctionNames(localFunctions, imports = typeImports) {
  const usedNames = new Set(['Parameters', ...imports.map(([name]) => name)]);
  const topLevelNames = new Set(localFunctions.filter(fn => fn.topLevel).map(fn => fn.name));
  return localFunctions.map(fn => {
    const needsSuffix = usedNames.has(fn.name) || (!fn.topLevel && topLevelNames.has(fn.name));
    const baseName = needsSuffix ? `${fn.name}_L${fn.startLine}C${fn.startColumn + 1}` : fn.name;
    const exportName = uniqueIdentifier(baseName, usedNames);
    const identifiers = new Set();
    const parameterNames = fn.parameters.map(name => uniqueIdentifier(name === '...' ? 'args' : name, identifiers));
    return { exportName, parameterNames };
  });
}

export function emitStickHeadSignatures(snapshots) {
  return emitPrefabSignatures(snapshots, {
    registrations,
    staticContracts,
    typeImports,
    helpers: { create_common: commonFactory },
  });
}

export function emitPrefabSignatures(snapshots, { registrations, staticContracts, typeImports, helpers = {} }) {
  const [{ localFunctions }] = snapshots;
  const contracts = registeredTypes(snapshots, registrations);
  const usedTypes = new Set();
  const names = prefabFunctionNames(localFunctions, typeImports);
  const declarations = localFunctions.map((fn, functionIndex) => {
    const { exportName, parameterNames } = names[functionIndex];
    const key = sourceKey(fn);
    const staticKinds = new Set(fn.staticUses?.map(({ kind }) => kind));
    const staticKind = staticKinds.size === 1 ? staticKinds.values().next().value : undefined;
    const contract =
      contracts.get(key) ??
      staticContracts.get(staticKind) ??
      (fn.topLevel && Object.hasOwn(helpers, fn.name) ? helpers[fn.name] : undefined);
    const parameters = fn.parameters.map((name, index) => {
      if (name === '...') {
        return `...${parameterNames[index]}: unknown[]`;
      }
      const type = contract?.parameters[index] ?? 'unknown';
      usedTypes.add(type);
      return `${parameterNames[index]}: ${type}`;
    });
    const returnType = contract?.returnType ?? (fn.returnsValue ? 'unknown' : 'void');
    usedTypes.add(returnType);
    return `/** ${fn.name} from ${fn.file}:${fn.startLine}. */
export type ${exportName} = (${parameters.join(', ')}) => ${returnType};`;
  });
  const imports = typeImports
    .filter(([name]) => [...usedTypes].some(type => type.match(/[\w$]+/g)?.includes(name)))
    .map(([name, from]) => `import type { ${name} } from '${from}';`);
  return [imports.join('\n'), ...declarations].join('\n\n').trim();
}
