import { advancePlayer, registerPlayer } from '../../animation/tests/playerVisual';
import { PrefabDisplayGroup } from '../../display/src';
import { prefabDisplay } from '../../display/src';
import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import * as THREE from 'three';
import { createStaffLightManager, DWARF_STAR_DURATION, DWARF_STAR_ID } from '../../prefab/src/stafflight';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { BufferedAction } from '../../stategraphs/src';
import { DisposeSounds, PrewarmSounds } from '../../prefab/src/sound';

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
  const scheduler = new GameTimeScheduler();
  const displays = new PrefabDisplayGroup(new THREE.Scene()), manager = createStaffLightManager(displays, '/dst/data/anim', { scheduler });
  // As the scene does before it starts, so each star's sounds play when it is spawned.
  await PrewarmSounds();
  await manager.spawn(DWARF_STAR_ID, new THREE.Vector3());
  await manager.spawn(DWARF_STAR_ID, new THREE.Vector3(2, 0, 3));
  const restored = await manager.spawn(DWARF_STAR_ID, new THREE.Vector3(4, 0, 5), { id: 'e_saved', components: { timer: { timers: { extinguish: { timeleft: 0.1, paused: false, initial_time: DWARF_STAR_DURATION } } } } });
  const samples = sources.map(({ source }) => ({ loop: source.loop, length: source.buffer!.length,
    channels: source.buffer!.numberOfChannels, sampleRate: source.buffer!.sampleRate }));
  const player = createWilsonPlayer('/dst/data/anim');
  registerPlayer(player);
  await prefabDisplay(player).artLoaded();
  const animation = prefabInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('yellowstaff');
  let casts = 0;
  animation.stategraph.pushBufferedAction(new BufferedAction('CASTSPELL', () => { casts += 1; }, undefined, {
    invobject: { prefab: 'yellowstaff', castsound: 'dontstarve/common/staffteleport', hasTag: () => false },
  }));
  for (let i = 0; i < 12; i++) advancePlayer(animation, 1 / 30);
  const beforeSoundFrame = sources.length;
  advancePlayer(animation, 1 / 30);
  const onSoundFrame = sources.length;
  for (let i = 0; i < 50; i++) advancePlayer(animation, 1 / 30);
  const afterCastSources = sources.length;
  await animation.setCarryItem(null);
  await animation.setCarryItem('yellowstaff');
  animation.stategraph.pushBufferedAction(new BufferedAction('CASTSPELL', () => { casts += 1; }, undefined, {
    invobject: { prefab: 'yellowstaff', castsound: 'dontstarve/common/staffteleport', hasTag: () => false },
  }));
  for (let i = 0; i < 12; i++) advancePlayer(animation, 1 / 30);
  await animation.setCarryItem(null);
  for (let i = 0; i < 30; i++) advancePlayer(animation, 1 / 30);
  const cancelledBeforeSound = sources.length === afterCastSources && casts === 1;
  const castBuffer = sources[6].source.buffer!;
  (window as unknown as { checkStarAudio: (action: string) => unknown }).checkStarAudio = (action) => {
    if (action === 'expire') {
      for (let i = 0; i < 72; i++) { scheduler.advance(1 / 60); displays.update(1 / 60, new THREE.Quaternion()); }
    }
    if (action === 'dispose') { manager.dispose(); DisposeSounds(); }
    return { state: context.state, restoredRemoved: restored.isRemoved,
      stops: sources.map(({ stops }) => stops) };
  };
  return { samples, casting: { beforeSoundFrame, onSoundFrame, afterCastSources, casts, cancelledBeforeSound,
    duration: castBuffer.length / castBuffer.sampleRate, loop: sources[6].source.loop } };
}
