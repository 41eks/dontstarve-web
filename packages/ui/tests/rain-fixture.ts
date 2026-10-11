import * as THREE from 'three';
import { createSignal } from '@dontstarve-web/signals';
import { RainEffect } from '../../prefab/src/rain';
import { DisposeSounds } from '../../prefab/src/sound';

const until = async (done: () => boolean, label: string) => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!done()) throw new Error(`Timed out waiting for ${label}`);
};

// Signal effects run after the writer returns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function checkRain() {
  const sources: { loop: boolean; samples: number; stopped: boolean }[] = [];
  const gains: GainNode[] = [];
  const createSource = AudioContext.prototype.createBufferSource;
  const createGain = AudioContext.prototype.createGain;
  AudioContext.prototype.createBufferSource = function () {
    const source = createSource.call(this);
    const record = { loop: false, samples: 0, stopped: false };
    const stop = source.stop.bind(source);
    source.stop = (when) => { record.stopped = true; stop(when); };
    const start = source.start.bind(source);
    source.start = (...args: [number?, number?, number?]) => {
      record.loop = source.loop; record.samples = source.buffer!.length; start(...args);
    };
    sources.push(record);
    return source;
  };
  AudioContext.prototype.createGain = function () { const gain = createGain.call(this); gains.push(gain); return gain; };
  try {
    const scene = new THREE.Scene();
    const rate = createSignal(0);
    const camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 5, Math.PI / 4, 0, 'YXZ'));
    const perspective = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 5000);
    perspective.quaternion.copy(camera);
    perspective.position.set(0, 40, 50).applyQuaternion(camera).setY(40);
    perspective.updateMatrixWorld();
    const rain = new RainEffect({ scene, dataBaseUrl: '/dst/data', animationBaseUrl: '/dst/data/anim',
      getFocus: () => new THREE.Vector3(), camera: perspective, rate });
    await until(() => scene.getObjectByName('rain') !== undefined, 'rain art');
    const mesh = scene.getObjectByName('rain') as THREE.Mesh;
    const frames = (count: number) => { for (let i = 0; i < count; i++) rain.update(1 / 30, camera); };
    const quads = () => mesh.geometry.drawRange.count / 6;
    frames(60);
    const dry = { quads: quads(), splashes: rain.renderEntities.length, sources: sources.length };

    rate.set(1);
    await until(() => sources.length === 3 && sources.every((source) => source.samples > 0), 'rain ambience');
    // Master gain, then one gain per heavy / medium / light layer.
    const layerGains = () => gains.slice(0, 4).slice(1).map((gain) => Number(gain.gain.value.toFixed(3)));
    const heavyGains = layerGains();
    frames(90);
    const heavy = { quads: quads(), splashes: rain.renderEntities.length };
    rate.set(0.2);
    await settle();
    const lightGains = layerGains();

    rate.set(0);
    await settle();
    const stopped = sources.every((source) => source.stopped);
    frames(90);
    const after = { quads: quads(), splashes: rain.renderEntities.length };
    rate.set(1);
    await settle();
    frames(3);
    const restarted = sources.length;

    rain.dispose();
    const removed = scene.getObjectByName('rain') === undefined;
    DisposeSounds();
    return { dry, ambience: sources.slice(0, 3).map(({ loop, samples }) => ({ loop, samples })), heavyGains, heavy, lightGains,
      stopped, after, restarted, removed };
  } finally {
    AudioContext.prototype.createBufferSource = createSource;
    AudioContext.prototype.createGain = createGain;
  }
}
