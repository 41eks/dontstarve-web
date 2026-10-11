import { createWilsonPlayer, type WilsonAnimationController, type WilsonCarryItem } from '../../prefab/src/player';
import { DisposeSounds } from '../../prefab/src/sound';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';

export async function checkToolSounds() {
  const sources: AudioBufferSourceNode[] = [];
  let context: AudioContext | undefined;
  const originalCreate = AudioContext.prototype.createBufferSource;
  const originalRandom = Math.random;
  AudioContext.prototype.createBufferSource = function () {
    context = this;
    const source = originalCreate.call(this);
    sources.push(source);
    return source;
  };
  try {
    const player = await createWilsonPlayer('/dst/data/anim');
    const animation = player.userData.animationController as WilsonAnimationController;
    const cases = [];
    for (const [tool, random] of [['hammer', 0], ['hammer', 0.99], ['pickaxe', 0], ['goldenpickaxe', 0]] as const) {
      await animation.setCarryItem(tool);
      let hits = 0;
      const before = sources.length;
      const start = () => tool === 'hammer' ? animation.playHammer(() => { hits++; }) : animation.playMine(() => { hits++; });
      const started = start();
      const ignoresBusy = !start();
      for (let f = 0; f < 15; f++) animation.update(1 / 30);
      const silentBeforeHit = hits === 0 && sources.length === before;
      Math.random = () => random;
      animation.update(1 / 30);
      Math.random = originalRandom;
      const source = sources.at(-1)!;
      const soundAtHit = hits === 1 && sources.length === before + 1;
      for (let f = 0; f < 90; f++) animation.update(1 / 30);
      cases.push({ tool, started, ignoresBusy, silentBeforeHit, soundAtHit,
        playsOnce: hits === 1 && sources.length === before + 1,
        duration: source.buffer!.length / source.buffer!.sampleRate,
        loop: source.loop, channels: source.buffer!.numberOfChannels });
    }
    const cancellations = [];
    for (const tool of ['hammer', 'pickaxe', 'goldenpickaxe'] satisfies WilsonCarryItem[]) {
      await animation.setCarryItem(tool);
      let hits = 0;
      const before = sources.length;
      const start = () => tool === 'hammer' ? animation.playHammer(() => { hits++; }) : animation.playMine(() => { hits++; });
      start();
      for (let f = 0; f < 15; f++) animation.update(1 / 30);
      if (tool === 'hammer') animation.cancelHammer(); else animation.cancelMine();
      for (let f = 0; f < 90; f++) animation.update(1 / 30);
      cancellations.push(hits === 0 && sources.length === before);
      start();
      for (let f = 0; f < 15; f++) animation.update(1 / 30);
      await animation.setCarryItem(null);
      for (let f = 0; f < 90; f++) animation.update(1 / 30);
      cancellations.push(hits === 0 && sources.length === before);
    }
    (window as unknown as { toolAudio: (dispose: boolean) => string }).toolAudio = (dispose) => {
      if (dispose) DisposeSounds();
      return context?.state ?? 'missing';
    };
    return { cases, cancellations };
  } finally {
    Math.random = originalRandom;
    AudioContext.prototype.createBufferSource = originalCreate;
  }
}

export async function checkGatheringSounds() {
  const sources: AudioBufferSourceNode[] = [];
  const stopped = new Set<AudioBufferSourceNode>();
  const originalCreate = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    const source = originalCreate.call(this), stop = source.stop.bind(source);
    source.stop = (...args) => { stopped.add(source); stop(...args); };
    sources.push(source);
    return source;
  };
  try {
    const player = await createWilsonPlayer('/dst/data/anim');
    const animation = player.userData.animationController as WilsonAnimationController;
    const target = { hasTag: () => false };
    let committed = 0;
    animation.stategraph.pushBufferedAction(new BufferedAction('PICK', () => { committed++; }, () => true, { target }));
    const phases: string[] = [];
    for (let frame = 0; frame < 60; frame++) {
      const before = sources.length;
      animation.update(1 / 60);
      if (sources.length > before) phases.push(animation.stategraph.animationClip.key);
    }
    const normal = { phases, layers: sources.length, loops: sources.map(source => source.loop), committed };
    animation.update(1);
    animation.stategraph.pushBufferedAction(new BufferedAction('PICK', () => { committed++; }, () => true, { target }));
    for (let frame = 0; frame < 20; frame++) animation.update(1 / 60);
    const beforeCancel = sources.length;
    animation.stategraph.cancelAction('PICK');
    for (let frame = 0; frame < 60; frame++) animation.update(1 / 60);
    return { normal, cancelStops: sources.slice(beforeCancel - 2, beforeCancel).every(source => stopped.has(source)),
      noSoundsAfterCancel: sources.length === beforeCancel, cancelPreservesProduct: committed === 1 };
  } finally { DisposeSounds(); AudioContext.prototype.createBufferSource = originalCreate; }
}
