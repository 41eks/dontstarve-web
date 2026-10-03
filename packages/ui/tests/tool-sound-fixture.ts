import { createWilsonPlayer, type WilsonAnimationController, type WilsonCarryItem } from '../../prefab/src/player';
import { DisposeSounds } from '../../prefab/src/sound';

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
      animation.playMine(() => { hits++; });
      for (let f = 0; f < 15; f++) animation.update(1 / 30);
      animation.cancelMine();
      for (let f = 0; f < 90; f++) animation.update(1 / 30);
      cancellations.push(hits === 0 && sources.length === before);
      animation.playMine(() => { hits++; });
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
