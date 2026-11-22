import { isDeepStrictEqual } from 'node:util';

function findCalls(recording, target, name) {
  return recording.operations.filter(
    operation =>
      operation.kind === 'call' &&
      operation.entity === recording.entity &&
      operation.target === target &&
      operation.name === name,
  );
}

function onlyCall(recording, target, name) {
  const calls = findCalls(recording, target, name);
  if (calls.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${calls.length}`);
  }
  return calls[0];
}

function requireSame(values, name) {
  if (values.length === 0 || values.some(value => !isDeepStrictEqual(value, values[0]))) {
    throw new Error(`${name} differs across the applicable scenarios`);
  }
  return values[0];
}

function positiveNumber(recording, target, name) {
  const { args } = onlyCall(recording, target, name);
  if (args.length !== 1 || !Number.isFinite(args[0]) || args[0] <= 0) {
    throw new Error(`Expected a positive ${target}.${name} in ${recording.scenario.name}`);
  }
  return args[0];
}

function readAppearance(recording) {
  const { assets, entity, operations, scenario } = recording;
  const prefix = operations.slice(0, operations.indexOf(onlyCall(recording, 'entity', 'SetPristine')));
  const initial = { scenario, entity, operations: prefix };
  const bank = onlyCall(initial, 'AnimState', 'SetBank').args;
  const build = onlyCall(initial, 'AnimState', 'SetBuild').args;
  const idle = onlyCall(initial, 'AnimState', 'PlayAnimation').args;
  const [asset] = assets;
  if (
    assets.length !== 1 ||
    asset?.type !== 'ANIM' ||
    build.length !== 1 ||
    typeof build[0] !== 'string' ||
    !/^[\w-]+$/.test(build[0]) ||
    asset.path !== `anim/${build[0]}.zip` ||
    bank.length !== 1 ||
    typeof bank[0] !== 'string' ||
    !bank[0] ||
    idle.length !== 1 ||
    typeof idle[0] !== 'string'
  ) {
    throw new Error('Expected one animation archive containing the recorded bank and build');
  }
  return { archive: asset.path.slice('anim/'.length), bank: bank[0], idleAnimation: idle[0] };
}

function readComponents(recording) {
  const workAction = onlyCall(recording, 'components.workable', 'SetWorkAction').args;
  const workLeft = onlyCall(recording, 'components.workable', 'SetWorkLeft');
  if (
    !isDeepStrictEqual(workAction, [{ kind: 'symbol', name: 'ACTIONS.HAMMER' }]) ||
    workLeft.args.length !== 1 ||
    !workLeft.literalArgument ||
    !Number.isSafeInteger(workLeft.args[0]) ||
    workLeft.args[0] <= 0
  ) {
    throw new Error(`Expected HAMMER and a positive integer literal for SetWorkLeft in ${recording.scenario.name}`);
  }

  const burnTime = positiveNumber(recording, 'components.burnable', 'SetBurnTime');
  const fxLevel = positiveNumber(recording, 'components.burnable', 'SetFXLevel');
  const [child] = onlyCall(recording, 'inst', 'SpawnChild').args;
  if (child !== 'flies') {
    throw new Error(`No stick head child display mapping for ${child}`);
  }
  return {
    child,
    workable: { action: workAction[0].name.slice('ACTIONS.'.length), workLeft: workLeft.args[0] },
    burnable: { burnTime, fxLevel },
  };
}

function readSharedCallback(snapshots, { name, target, method, prefixArgs, minParameters, maxParameters }) {
  const callbacks = snapshots.flatMap(({ prefab, recordings }) =>
    recordings
      .filter(recording => recording.scenario.master)
      .map(recording => {
        const registrations = findCalls(recording, target, method).filter(call =>
          prefixArgs.every((argument, index) => call.args[index] === argument),
        );
        if (registrations.length !== 1) {
          throw new Error(`${prefab}: expected one ${name} registration in ${recording.scenario.name}`);
        }
        const { args, source } = registrations[0];
        const callback = args[prefixArgs.length];
        if (
          args.length !== prefixArgs.length + 1 ||
          callback?.kind !== 'callback' ||
          callback.name !== name ||
          callback.parameters.length < minParameters ||
          callback.parameters.length > maxParameters ||
          callback.parameters.includes('...')
        ) {
          throw new Error(`${prefab}: unsupported ${name} registration at ${source.file}:${source.line}`);
        }
        return callback;
      }),
  );
  return requireSame(callbacks, `${name} callback declaration`);
}

export function stickHeadCallbacks(snapshots) {
  return {
    onFullMoon: readSharedCallback(snapshots, {
      name: 'OnFullMoon',
      target: 'inst',
      method: 'WatchWorldState',
      prefixArgs: ['isfullmoon'],
      minParameters: 2,
      maxParameters: 2,
    }),
    onWorked: readSharedCallback(snapshots, {
      name: 'OnWorked',
      target: 'components.workable',
      method: 'SetOnWorkCallback',
      prefixArgs: [],
      minParameters: 1,
      maxParameters: 4,
    }),
  };
}

export function stickHeadConfig({ prefab, recordings }) {
  try {
    const appearance = requireSame(recordings.map(readAppearance), 'initial art and animation');
    const tags = requireSame(
      recordings.map(recording => findCalls(recording, 'inst', 'AddTag').map(operation => operation.args[0])),
      'constructor tags',
    );
    const components = requireSame(
      recordings.filter(recording => recording.scenario.master).map(readComponents),
      'component settings',
    );
    const fullMoon = recordings.find(recording => recording.scenario.master && recording.scenario.fullMoon);
    const plays = findCalls(fullMoon, 'AnimState', 'PlayAnimation');
    const [idleAwake, loop] = onlyCall(fullMoon, 'AnimState', 'PushAnimation').args;
    const wakeAnimation = plays[1]?.args[0];
    if (
      plays.length !== 2 ||
      plays[1].args.length !== 1 ||
      typeof wakeAnimation !== 'string' ||
      typeof idleAwake !== 'string' ||
      loop !== false
    ) {
      throw new Error('Expected the full-moon constructor to play a wake clip and queue a one-shot idle clip');
    }
    return { ...appearance, wakeAnimation, idleAwake, tags, ...components };
  } catch (error) {
    throw new Error(`${prefab}: ${error.message}`, { cause: error });
  }
}
