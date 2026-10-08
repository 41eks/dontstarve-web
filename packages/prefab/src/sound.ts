import { TILE_SIZE } from './tile';

// dontstarve.fev file_index is zero-based; these vgmstream stream IDs are one-based.
const sounds = {
  // torch.lua → dontstarve.fev sound definitions 42/44 → file_index + 1.
  'dontstarve/wilson/torch_swing': { bank: 'wilson', streams: [95, 96], loop: false },
  'dontstarve/common/fireOut': { bank: 'common', streams: [198], loop: false },
  'dontstarve/wilson/equip_item_gold': { bank: 'wilson', streams: [115], loop: false },
  'dontstarve/wilson/dig': { bank: 'wilson', streams: [64, 65, 66], loop: false },
  'dontstarve_DLC001/creatures/mole/emerge': { bank: 'mole', streams: [2, 3, 4], loop: false },
  // farmplantable.lua / SGwilson.lua → dontstarve.fev (file_index + 1).
  'dontstarve/common/plant': { bank: 'common', streams: [170, 171, 172, 173, 174], loop: false },
  'dontstarve/wilson/eat': { bank: 'wilson', streams: [112, 113, 114], loop: false },
  // SGwilson.lua DoEatSound → dontstarve.fev sounddef 1712 → sfx file_index 1286.
  'dontstarve/wilson/sip': { bank: 'sfx', streams: [1287], loop: false },
  // phonograph.lua → dontstarve.fev → gramaphone banks (file_index + 1).
  'dontstarve/music/gramaphone_ragtime': { bank: 'gramaphone', streams: [10], loop: true },
  'dontstarve/music/gramaphone_creepyforest': { bank: 'gramaphone', streams: [4], loop: true },
  'dontstarve/music/gramaphone_drstyle': { bank: 'gramaphone', streams: [7], loop: true },
  'dontstarve/music/gramaphone_efs': { bank: 'gramaphone', streams: [9], loop: true },
  'dontstarve/music/gramaphone_hallowednights': { bank: 'music_frontend_hallowednights2024', streams: [1], loop: true },
  'dontstarve/music/gramaphone_end': { bank: 'gramaphone', streams: [12], loop: false },
  'farming/common/farm/plow/drill_pre': { bank: 'farming', streams: [90], loop: false },
  'farming/common/farm/plow/LP': { bank: 'farming', streams: [82, 83, 84], loop: true,
    layers: [{ bank: 'farming', streams: [85] }, { bank: 'farming', streams: [86] },
      { bank: 'farming', streams: [87] }, { bank: 'farming', streams: [88] }] },
  'farming/common/farm/plow/collapse': { bank: 'farming', streams: [89], loop: false },
  'farming/common/farm/plow/dirt_puff': { bank: 'farming', streams: [9], loop: false,
    layers: [{ bank: 'farming', streams: [10] }] },
  'dontstarve/common/staff_star_create': { bank: 'common', streams: [273], loop: false },
  'dontstarve/common/staff_star_LP': { bank: 'common', streams: [274], loop: true },
  'dontstarve/wilson/use_gemstaff': { bank: 'common', streams: [284], loop: false },
  'dontstarve/common/staffteleport': { bank: 'common', streams: [284], loop: false },
  // FEV has three simultaneous layers, each with one sound definition.
  'dontstarve/common/staff_coldlight_LP': { bank: 'sfx', streams: [796], loop: true,
    layers: [{ bank: 'sfx', streams: [797] }, { bank: 'common', streams: [158] }] },
  'dontstarve/wilson/hit': { bank: 'sfx', streams: [423, 424], loop: false },
  'dontstarve/common/destroy_smoke': { bank: 'common', streams: [56, 57, 58, 59], loop: false,
    layers: [{ bank: 'common', streams: [62] }, { bank: 'common', streams: [187] }] },
  'dontstarve/common/destroy_wood': { bank: 'common', streams: [64], loop: false },
  'dontstarve/wilson/use_pick_rock': { bank: 'wilson', streams: [124], loop: false },
  'dontstarve/common/icebox_open': { bank: 'sfx', streams: [383], loop: false },
  'dontstarve/common/icebox_close': { bank: 'sfx', streams: [382], loop: false },
  'dontstarve/wilson/chest_open': { bank: 'wilson', streams: [15], loop: false },
  'dontstarve/wilson/chest_close': { bank: 'wilson', streams: [14], loop: false },
  'dontstarve/wilson/attack_weapon': { bank: 'sfx', streams: [1230, 1231, 1232, 1233], loop: false },
  'dontstarve/common/together/reskin_tool': { bank: 'sfx', streams: [827, 828, 829, 830, 831, 832], loop: false },
  'terraria1/skins/spectrepaintbrush': { bank: 'terraria1', streams: [241, 242, 243], loop: false },
  // FEV spawn_vines group: three simultaneous idle layers + one-shot variants.
  'dontstarve/common/together/spawn_vines/spawnportal_idle': { bank: 'sfx', streams: [356], loop: true,
    layers: [{ bank: 'sfx', streams: [357] }, { bank: 'sfx', streams: [358] }] },
  'dontstarve/common/together/spawn_vines/spawnportal_jacob': { bank: 'common', streams: [94, 95, 96], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_spawning': { bank: 'common', streams: [102], loop: true },
  'dontstarve/common/together/spawn_vines/spawnportal_shake': { bank: 'common', streams: [101], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_open': { bank: 'common', streams: [97], loop: false },
} as const;
export type SoundEventPath = keyof typeof sounds;
export interface SoundHandle { stop(): void; }
export interface SoundPosition { readonly x: number; readonly z: number; }
export const SOUND_MAX_DISTANCE = TILE_SIZE * 8;

/** Full volume within one tile, inverse-square falloff, then silence at the cutoff. */
export function inverseSquareAttenuation(
  distance: number, referenceDistance = TILE_SIZE, maxDistance = SOUND_MAX_DISTANCE,
): number {
  if (distance >= maxDistance) return 0;
  return (referenceDistance / Math.max(referenceDistance, distance)) ** 2;
}

let context: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer>();
const requests = new Map<string, Promise<AudioBuffer>>();
const playing = new Set<SoundHandle>();
const spatialSounds = new Map<SoundHandle, { position: SoundPosition; gain: GainNode }>();
const listener: { x: number; z: number } = { x: 0, z: 0 };

function updateGain({ position, gain }: { position: SoundPosition; gain: GainNode }): void {
  gain.gain.value = inverseSquareAttenuation(Math.hypot(position.x - listener.x, position.z - listener.z));
}

/** Call each frame after movement; source positions are retained by reference. */
export function UpdateSoundListener(position: SoundPosition): void {
  listener.x = position.x;
  listener.z = position.z;
  for (const sound of spatialSounds.values()) updateGain(sound);
}

function unlock(): void {
  if (context?.state === 'suspended') void context.resume().catch(() => undefined);
}

function getContext(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  if (!context) {
    context = new AudioContext();
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }
  return context;
}

function soundLayers(path: SoundEventPath): string[][] {
  const event = sounds[path];
  const layers = [event, ...('layers' in event ? event.layers : [])];
  return layers.map((layer) => layer.streams.map((stream) => `${layer.bank}.fsb-${stream}.wav`));
}

function loadSound(filename: string, audio: AudioContext): Promise<AudioBuffer> {
  let request = requests.get(filename);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}dst/data/sound/${filename}`);
      if (!response.ok) throw new Error(`Unable to load ${filename}: ${response.status}`);
      const buffer = await audio.decodeAudioData(await response.arrayBuffer());
      if (audio === context) buffers.set(filename, buffer);
      return buffer;
    })();
    requests.set(filename, request);
    void request.catch(() => { if (requests.get(filename) === request) requests.delete(filename); });
  }
  return request;
}

export async function PreloadSounds(...paths: SoundEventPath[]): Promise<void> {
  const audio = getContext();
  if (!audio) return;
  await Promise.all(paths.flatMap((path) => soundLayers(path).flat()).map((filename) => loadSound(filename, audio).catch((error: unknown) => {
    if (audio === context) console.warn(`Unable to prepare ${filename}`, error);
  })));
}

/** Optional ground position enables distance attenuation; omitted positions play at full volume. */
export function PlaySound(path: SoundEventPath, position?: SoundPosition, offsetSeconds = 0): SoundHandle {
  const audio = getContext();
  const filenames = soundLayers(path).map((files) => files.length === 1 ? files[0] : files[Math.floor(Math.random() * files.length)]);
  const sources = new Set<AudioBufferSourceNode>();
  let remaining = filenames.length;
  let stopped = false;
  const gain = audio && position ? audio.createGain() : undefined;
  const handle: SoundHandle = { stop() {
    if (stopped) return;
    stopped = true;
    playing.delete(handle);
    spatialSounds.delete(handle);
    for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
    sources.clear();
    gain?.disconnect();
  } };
  if (!audio) return handle;
  playing.add(handle);
  if (gain && position) {
    const sound = { position, gain };
    spatialSounds.set(handle, sound);
    updateGain(sound);
    gain.connect(audio.destination);
  }
  const start = (buffer: AudioBuffer) => {
    if (stopped || audio !== context) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = sounds[path].loop;
    source.connect(gain ?? audio.destination);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (--remaining === 0) {
        stopped = true;
        playing.delete(handle);
        spatialSounds.delete(handle);
        gain?.disconnect();
      }
    };
    if (offsetSeconds > 0 && buffer.duration > 0) source.start(0, offsetSeconds % buffer.duration);
    else source.start();
  };
  for (const filename of filenames) {
    const buffer = buffers.get(filename);
    if (buffer) start(buffer);
    else void loadSound(filename, audio).then(start).catch((error: unknown) => {
      handle.stop();
      if (audio === context) console.warn(`Unable to play ${path}`, error);
    });
  }
  return handle;
}

/** Release the shared audio service when the game is closed. */
export function DisposeSounds(): void {
  for (const sound of playing) sound.stop();
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  }
  void context?.close().catch(() => undefined);
  context = undefined;
  buffers.clear();
  requests.clear();
  listener.x = listener.z = 0;
}
