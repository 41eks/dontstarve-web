import * as THREE from 'three';
import { DwarfStarManager } from '../../prefab/src/stafflight';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { BufferedAction } from '../../stategraphs/src';
import { DisposeSounds } from '../../prefab/src/sound';

export async function prepareStarAudioCheck() {
  const sources: { source: AudioBufferSourceNode; stops: number }[] = [];
  let context: AudioContext;
  const createSource = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    context = this;
    const source = createSource.call(this);
    const entry = { source, stops: 0 };
    const stop = source.stop.bind(source);
    source.stop = (...args) => { entry.stops += 1; stop(...args); };
    sources.push(entry);
    return source;
  };
  const manager = new DwarfStarManager(new THREE.Scene(), '/dst/data/anim');
  await manager.prepare();
  await manager.spawn(new THREE.Vector3());
  await manager.spawn(new THREE.Vector3(2, 0, 3));
  const restored = await manager.spawn(new THREE.Vector3(4, 0, 5), { id: 'e_saved', remainingSeconds: 0.1 });
  const samples = sources.map(({ source }) => ({ loop: source.loop, length: source.buffer!.length,
    channels: source.buffer!.numberOfChannels, sampleRate: source.buffer!.sampleRate }));
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('yellowstaff');
  let casts = 0;
  animation.stategraph.pushBufferedAction(new BufferedAction('CASTSPELL', () => { casts += 1; }, undefined, {
    invobject: { prefab: 'yellowstaff', castsound: 'dontstarve/common/staffteleport', hasTag: () => false },
  }));
  for (let i = 0; i < 12; i++) animation.update(1 / 30);
  const beforeSoundFrame = sources.length;
  animation.update(1 / 30);
  const onSoundFrame = sources.length;
  for (let i = 0; i < 50; i++) animation.update(1 / 30);
  const afterCastSources = sources.length;
  await animation.setCarryItem(null);
  await animation.setCarryItem('yellowstaff');
  animation.stategraph.pushBufferedAction(new BufferedAction('CASTSPELL', () => { casts += 1; }, undefined, {
    invobject: { prefab: 'yellowstaff', castsound: 'dontstarve/common/staffteleport', hasTag: () => false },
  }));
  for (let i = 0; i < 12; i++) animation.update(1 / 30);
  await animation.setCarryItem(null);
  for (let i = 0; i < 30; i++) animation.update(1 / 30);
  const cancelledBeforeSound = sources.length === afterCastSources && casts === 1;
  const castBuffer = sources[5].source.buffer!;
  (window as unknown as { checkStarAudio: (action: string) => unknown }).checkStarAudio = (action) => {
    if (action === 'expire') {
      for (let i = 0; i < 72; i++) manager.update(1 / 60, new THREE.Quaternion());
    }
    if (action === 'dispose') { manager.dispose(); DisposeSounds(); }
    return { state: context.state, restoredRemoved: !restored.parent,
      stops: sources.map(({ stops }) => stops) };
  };
  return { samples, casting: { beforeSoundFrame, onSoundFrame, afterCastSources, casts, cancelledBeforeSound,
    duration: castBuffer.length / castBuffer.sampleRate, loop: sources[5].source.loop } };
}
