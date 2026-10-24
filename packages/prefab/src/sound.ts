import { Vector3 } from 'three';
import { TILE_SIZE } from './tile';

// dontstarve.fev file_index is zero-based; these vgmstream stream IDs are one-based.
const sounds = {
  // flies.lua → dontstarve.fev sounddef 56 → common file_index 74–80 (Flies_soothed_DST_-001..007).
  'dontstarve/common/flies': { bank: 'common', streams: [75, 76, 77, 78, 79, 80, 81], loop: true },
  // grass.lua → dontstarve.fev sounddef 19 → wilson file_index 115–118.
  'dontstarve/wilson/pickup_reeds': { bank: 'wilson', streams: [116, 117, 118, 119], loop: false },
  // SGwilson.lua dolongaction → dontstarve.fev sounddefs 1758/1759, two layers.
  // Short whooshes are triggered by build_loop cycles; raw sample looping repeats too quickly.
  'dontstarve/wilson/make_trap': { bank: 'wilson', streams: [71, 72, 73, 74, 75], loop: false,
    layers: [{ bank: 'wilson', streams: [76, 77, 78, 79, 80] }] },
  // flower_cave.lua onpickedfn → dontstarve.fev sounddef 1023 → wilson file_index 66.
  'dontstarve/wilson/pickup_lightbulb': { bank: 'wilson', streams: [67], loop: false },
  // cookpot.lua → dontstarve.fev sounddefs 246 / 353 / 203 (file_index + 1).
  'dontstarve/common/cookingpot_rattle': { bank: 'common', streams: [49, 50, 51, 52, 53, 54, 55], loop: true },
  'dontstarve/common/cookingpot_close': { bank: 'common', streams: [340], loop: false },
  'dontstarve/common/cookingpot_finish': { bank: 'common', streams: [301], loop: false },
  // torch.lua → dontstarve.fev sound definitions 42/44 → file_index + 1.
  'dontstarve/wilson/torch_swing': { bank: 'wilson', streams: [95, 96], loop: false },
  'dontstarve/common/fireOut': { bank: 'common', streams: [198], loop: false },
  // fire.lua → dontstarve.fev sounddefs 1762 / 1765 / 1766, three simultaneous layers.
  'dontstarve/common/campfire': { bank: 'common', streams: [149, 150, 151, 152], loop: true,
    layers: [{ bank: 'common', streams: [153, 154, 155, 156] }, { bank: 'common', streams: [158, 159, 160, 161] }] },
  // tent.lua → dontstarve.fev sounddefs 1334 (eleven tent_sleep_loop variants, sfx file_index 394–404), 171 and 172.
  'dontstarve/common/tent_sleep': { bank: 'sfx', streams: [395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405], loop: false },
  'dontstarve/common/tent_dis_pre': { bank: 'common', streams: [103], loop: false },
  'dontstarve/common/tent_dis_twirl': { bank: 'common', streams: [104], loop: false },
  // pigking.lua / SGpigking.lua → dontstarve.fev sounddefs 73 / 71 / 72 → pig file_index 0 / 1 / 2.
  'dontstarve/pig/PigKingThrowGold': { bank: 'pig', streams: [1], loop: false },
  'dontstarve/pig/PigKingHappy': { bank: 'pig', streams: [2], loop: false },
  'dontstarve/pig/PigKingReject': { bank: 'pig', streams: [3], loop: false },
  // nightmarerock / SGnightmarerock.lua → dontstarve.fev sounddefs 1777 (ghostup) / 1779 (down) layered with 1778 (rockup_1..4),
  // sanity file_index 47 / 46 / 48–51 (+ 1).
  'dontstarve/sanity/shadowrock_up': { bank: 'sanity', streams: [48], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_reveal': { bank: 'sanity', streams: [48], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_down': { bank: 'sanity', streams: [47], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_conseal': { bank: 'sanity', streams: [47], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
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
  // staff.lua → dontstarve.fev sounddefs 926 / 980 / 981 / 982, file_index + 1.
  'dontstarve/common/staff_dissassemble': { bank: 'common', streams: [272], loop: false },
  'dontstarve/common/destroy_magic': { bank: 'common', streams: [189], loop: false },
  'dontstarve/common/destroy_clothing': { bank: 'common', streams: [188], loop: false },
  'dontstarve/common/destroy_tool': { bank: 'common', streams: [190], loop: false },
  // staff.lua onfinished → sounddef 917 → gem_shatter.wav, zero-based file_index 202.
  'dontstarve/common/gem_shatter': { bank: 'common', streams: [203], loop: false },
  // FEV has three simultaneous layers, each with one sound definition.
  'dontstarve/common/staff_coldlight_LP': { bank: 'sfx', streams: [796], loop: true,
    layers: [{ bank: 'sfx', streams: [797] }, { bank: 'common', streams: [158] }] },
  'dontstarve/wilson/hit': { bank: 'sfx', streams: [423, 424], loop: false },
  'dontstarve/common/destroy_smoke': { bank: 'common', streams: [56, 57, 58, 59], loop: false,
    layers: [{ bank: 'common', streams: [62] }, { bank: 'common', streams: [187] }] },
  'dontstarve/common/destroy_wood': { bank: 'common', streams: [64], loop: false },
  // axe.lua / moontree.lua → dontstarve.fev use_axe_tree: sounddefs 1763 (common) + 1764 (sfx), file_index + 1.
  'dontstarve/wilson/use_axe_tree': { bank: 'common', streams: [337, 339, 338], loop: false,
    layers: [{ bank: 'sfx', streams: [1246, 1247, 1248, 1249, 1237, 1242, 1243, 1244, 1245, 1238, 1239, 1240, 1241] }] },
  // moontree.lua on_chop_tree_down → dontstarve.fev treeFall: tree_fall_1.wav, forest file_index 8.
  'dontstarve/forest/treeFall': { bank: 'forest', streams: [9], loop: false },
  // winterometer.lua onbuilt → dontstarve.fev sounddef 1331 (Thermal_measurer_craft.wav) → common file_index 175.
  'dontstarve/common/winter_meter_craft': { bank: 'common', streams: [176], loop: false },
  // sculptingtable.lua onbuilt → dontstarve.fev sounddef sfx/together/sculpting_table/sculpting_station_craft-01.wav → sfx stream 910.
  'dontstarve/common/together/sculpting_table/craft': { bank: 'sfx', streams: [910], loop: false },
  // moonbase.lua / sculptingtable.lua → dontstarve.fev sounddefs 2381 + 2355, two simultaneous layers.
  // place_structure_wood (common file_index 232) + one of 18 Medium_rock_impact variants (sfx file_index + 1).
  'dontstarve/common/together/moonbase/moonstaff_place': { bank: 'common', streams: [233], loop: false,
    layers: [{ bank: 'sfx', streams: [857, 859, 861, 862, 863, 864, 865, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 858] }] },
  // moonbase.lua OnRepaired → dontstarve.fev sounddefs 2380 / 2354 / 2319, three simultaneous layers.
  'dontstarve/common/together/moonbase/repair': { bank: 'wilson', streams: [124], loop: false,
    layers: [{ bank: 'sfx', streams: [846, 857, 859, 860, 861, 862, 863, 864, 865, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 858] },
      { bank: 'sfx', streams: [1274] }] },
  // positronbeam.lua → FEV defs 2154–2156 (same file, adjacent intensity bands) + 2344.
  // FEV layer 1 volume envelope, EPRP points 357–359; layer 0 has no envelope.
  'dontstarve/common/together/moonbase/beam': { bank: 'sfx', streams: [790], loop: true,
    layers: [{ bank: 'sfx', streams: [794] }],
    intensity: [null, [[0, .63589698], [.526735, .702564], [.69965899, 1]]] },
  'dontstarve/common/together/moonbase/beam_level_up': { bank: 'sfx', streams: [792], loop: false },
  'dontstarve/common/together/moonbase/beam_stop': { bank: 'sfx', streams: [795], loop: false },
  'dontstarve/common/together/moonbase/beam_stop_fail': { bank: 'sfx', streams: [793], loop: false },
  // weather.lua StartAmbientRainSound → dontstarve.fev AMB/rain: sounddefs 2019 / 2018 / 2017 are
  // amb_rain_heavy / medium / light_LP (forest_stream file_index 73 / 75 / 74, checked with `-m -s`).
  // `intensity` volume envelopes are EPRP points 6,14,15 (heavy), 6,16,17 (medium) and 3,18,9 (light).
  'dontstarve/AMB/rain': { bank: 'forest_stream', streams: [74], loop: true,
    layers: [{ bank: 'forest_stream', streams: [76] }, { bank: 'forest_stream', streams: [75] }],
    intensity: [[[0, 0], [.404372, 0], [.696721, 1]], [[0, 0], [.342896, 1], [.500662, 1]],
      [[0, 1], [.381457, 1], [.598485, 1]]] },
  // dynamicmusic.lua's Wilson branch: defs 2266 / 2267. Wigfrid's parameter-gated opera layer stays off.
  'dontstarve/music/music_epicfight_moonbase': { bank: 'music', streams: [25], loop: true },
  'dontstarve/music/music_epicfight_moonbase_b': { bank: 'music', streams: [26], loop: true },
  // dontstarve.fev sounddefs 264 / 265: zero-based file_index 59 / 60.
  'dontstarve/common/destroy_metal': { bank: 'common', streams: [60], loop: false },
  'dontstarve/common/destroy_stone': { bank: 'common', streams: [61], loop: false },
  'dontstarve/common/destroy_straw': { bank: 'common', streams: [63], loop: false },
  // butterfly.lua OnWorked → FEV sounddef 183 → zero-based file_index 21–23.
  'dontstarve/common/butterfly_trap': { bank: 'common', streams: [22, 23, 24], loop: false },
  // birdcage.lua → dontstarve.fev sounddefs 307 (bird_wingflap_1..6, birds file_index 25–30) and 1338 (Birdcage_craft, sfx file_index 345).
  'dontstarve/birds/wingflap_cage': { bank: 'birds', streams: [26, 27, 28, 29, 30, 31], loop: false },
  'dontstarve/common/birdcage_craft': { bank: 'sfx', streams: [346], loop: false },
  // birds.lua BIRD_SOUNDS.chirp → sounddefs 304 / 305 / 306 (birds) and 2175 (together canary_chirp_dst_1..12), file_index + 1.
  'dontstarve/birds/chirp_crow': { bank: 'birds', streams: [14, 15, 16], loop: false },
  'dontstarve/birds/chirp_robin': { bank: 'birds', streams: [4, 5, 6], loop: false },
  'dontstarve/birds/chirp_junco': { bank: 'birds', streams: [1, 2, 3], loop: false },
  'dontstarve/birds/chirp_canary': { bank: 'together', streams: [748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759], loop: false },
  // birds.lua BIRD_SOUNDS.death → sounddefs 3171+3170 / 3169+3170 / 3196+3170 (chirp over bird_fall_drop_dead, sfx file_index 126–128)
  // and 2177+1370 (canary_death_2 over canary_cough_dst_4..6, together file_index 762–766).
  'dontstarve/birds/death_crow': { bank: 'birds', streams: [14, 15, 16], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_robin': { bank: 'birds', streams: [4, 5, 6], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_junco': { bank: 'birds', streams: [1, 2, 3], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_canary': { bank: 'together', streams: [766, 767], loop: false,
    layers: [{ bank: 'together', streams: [763, 764, 765] }] },
  // SGwilson.lua shave → dontstarve.fev sounddef 82 (sfx/wilson/Shave_1..6.wav) → wilson file_index 87–92.
  'dontstarve/wilson/shave_LP': { bank: 'wilson', streams: [88, 89, 90, 91, 92, 93], loop: true },
  // SGwilson.lua toolbroke → dontstarve.fev sounddef 65 (sfx/wilson/Tool_Break.wav) → wilson file_index 93.
  'dontstarve/wilson/use_break': { bank: 'wilson', streams: [94], loop: false },
  'dontstarve/wilson/use_pick_rock': { bank: 'wilson', streams: [124], loop: false },
  // rock_break_fx.lua → dontstarve.fev sounddef 84 → wilson file_index 24 (Stone_break.wav).
  'dontstarve/wilson/rock_break': { bank: 'wilson', streams: [25], loop: false },
  'dontstarve/common/icebox_open': { bank: 'sfx', streams: [383], loop: false },
  'dontstarve/common/icebox_close': { bank: 'sfx', streams: [382], loop: false },
  'dontstarve/wilson/chest_open': { bank: 'wilson', streams: [15], loop: false },
  'dontstarve/wilson/chest_close': { bank: 'wilson', streams: [14], loop: false },
  'dontstarve/wilson/attack_weapon': { bank: 'sfx', streams: [1230, 1231, 1232, 1233], loop: false },
  // SGwilson.lua attack punch / toolpunch → dontstarve.fev sounddef 441 → sfx file_index 1220–1223.
  'dontstarve/wilson/attack_whoosh': { bank: 'sfx', streams: [1221, 1222, 1223, 1224], loop: false },
  // SGwilson.lua attack, "shadow" weapons → sounddef 513 → sfx file_index 1224–1228.
  'dontstarve/wilson/attack_nightsword': { bank: 'sfx', streams: [1225, 1226, 1227, 1228, 1229], loop: false },
  'dontstarve/common/together/reskin_tool': { bank: 'sfx', streams: [827, 828, 829, 830, 831, 832], loop: false },
  'terraria1/skins/spectrepaintbrush': { bank: 'terraria1', streams: [241, 242, 243], loop: false },
  // FEV spawn_vines group: three simultaneous idle layers + one-shot variants.
  'dontstarve/common/together/spawn_vines/spawnportal_idle': { bank: 'sfx', streams: [356], loop: true,
    layers: [{ bank: 'sfx', streams: [357] }, { bank: 'sfx', streams: [358] }] },
  'dontstarve/common/together/spawn_vines/spawnportal_jacob': { bank: 'common', streams: [94, 95, 96], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_spawning': { bank: 'common', streams: [102], loop: true },
  'dontstarve/common/together/spawn_vines/spawnportal_shake': { bank: 'common', streams: [101], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_open': { bank: 'common', streams: [97], loop: false },
  // SGwilson.lua book2 → dontstarve.fev sounddefs 1301 / 1280 / 902 (file_index + 1).
  'dontstarve/common/use_book_light': { bank: 'together', streams: [481, 482, 483, 484], loop: false },
  'dontstarve/common/use_book_close': { bank: 'sfx', streams: [347, 348, 349, 350], loop: false },
  // SGwilson.lua play_flute → dontstarve.fev wilson/flute_LP → sounddef 88 → wilson ReedFlute_1..7 (file_index 80–86).
  'dontstarve/wilson/flute_LP': { bank: 'wilson', streams: [81, 82, 83, 84, 85, 86, 87], loop: false },
  'dontstarve/common/book_spell': { bank: 'common', streams: [148], loop: false },
  // books.lua layer_sound / book_fx.lua OnFail → wickerbottom_rework.fev sounddefs 17+23 / 16.
  'wickerbottom_rework/book_spells/silviculture': { bank: 'wickerbottom_rework', streams: [13], loop: false,
    layers: [{ bank: 'wickerbottom_rework', streams: [20] }] },
  // fx.lua fx_book_rain → wickerbottom_rework.fev sounddefs 9 / 20 (file_index 9 / 10 → book_rain_DST, book_rain_sparkle).
  'wickerbottom_rework/book_spells/rain': { bank: 'wickerbottom_rework', streams: [10], loop: false,
    layers: [{ bank: 'wickerbottom_rework', streams: [11] }] },
  'wickerbottom_rework/book_spells/fail': { bank: 'wickerbottom_rework', streams: [3], loop: false },
} as const;
export type SoundEventPath = keyof typeof sounds;
export interface SoundHandle {
  stop(): void;
  /** SoundEmitter:PlayingSound for this handle. */
  isPlaying(): boolean;
  /** SoundEmitter:SetVolume, multiplied with distance attenuation. */
  setVolume(volume: number): void;
  setParameter?(name: string, value: number): void;
}
export const SOUND_MAX_DISTANCE = TILE_SIZE * 8;

/** Full volume within one tile, inverse-square falloff, then silence at the cutoff. */
export function inverseSquareAttenuation(
  position: Vector3, listenerPosition: Vector3, referenceDistance = TILE_SIZE, maxDistance = SOUND_MAX_DISTANCE,
): number {
  const distanceSquared = position.distanceToSquared(listenerPosition);
  if (distanceSquared >= maxDistance * maxDistance) return 0;
  const referenceSquared = referenceDistance * referenceDistance;
  return referenceSquared / Math.max(referenceSquared, distanceSquared);
}

let context: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer>();
const requests = new Map<string, Promise<AudioBuffer>>();
const playing = new Set<SoundHandle>();
const soundGains = new Map<SoundHandle, { position?: Vector3; gain: GainNode; volume: number }>();
const listener = new Vector3();

function updateGain({ position, gain, volume }: { position?: Vector3; gain: GainNode; volume: number }): void {
  gain.gain.value = volume * (position ? inverseSquareAttenuation(position, listener) : 1);
}

/** Call each frame after movement; source positions are retained by reference. */
export function UpdateSoundListener(position: Vector3): void {
  listener.copy(position);
  for (const sound of soundGains.values()) updateGain(sound);
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

type Envelope = readonly (readonly [number, number])[];

/** Per-layer FEV `intensity` volume envelopes; `null` layers play at constant volume. */
function intensityEnvelopes(path: SoundEventPath): readonly (Envelope | null)[] | undefined {
  const event = sounds[path];
  return 'intensity' in event ? event.intensity : undefined;
}

/** FEV envelope points are linear between neighbours and hold the first/last value outside them. */
function evaluateEnvelope(points: Envelope, x: number): number {
  const next = points.findIndex((point) => point[0] >= x);
  if (next === 0) return points[0][1];
  if (next < 0) return points[points.length - 1][1];
  const [a, b] = [points[next - 1], points[next]];
  return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
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
export function PlaySound(path: SoundEventPath, position?: Vector3, offsetSeconds = 0): SoundHandle {
  const audio = getContext();
  const filenames = soundLayers(path).map((files) => files.length === 1 ? files[0] : files[Math.floor(Math.random() * files.length)]);
  const sources = new Set<AudioBufferSourceNode>();
  const layerGains: GainNode[] = [];
  const envelopes = intensityEnvelopes(path);
  let remaining = filenames.length;
  let stopped = false;
  const gain = audio?.createGain();
  const sound = gain ? { position, gain, volume: 1 } : undefined;
  const handle: SoundHandle = {
    isPlaying: () => !stopped && audio !== undefined,
    setVolume(volume) {
      if (!Number.isFinite(volume) || volume < 0) throw new RangeError('Invalid sound volume');
      if (!sound) return;
      sound.volume = volume;
      updateGain(sound);
    },
    setParameter(name, value) {
      if (!Number.isFinite(value)) throw new RangeError('Invalid sound parameter');
      if (name !== 'intensity' || !envelopes) return;
      const x = Math.max(0, Math.min(1, value));
      envelopes.forEach((points, index) => { if (points && layerGains[index]) layerGains[index].gain.value = evaluateEnvelope(points, x); });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      playing.delete(handle);
      soundGains.delete(handle);
      for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
      sources.clear();
      for (const layer of layerGains) layer.disconnect();
      gain?.disconnect();
    },
  };
  if (!audio) return handle;
  playing.add(handle);
  if (gain && sound) {
    soundGains.set(handle, sound);
    updateGain(sound);
    gain.connect(audio.destination);
  }
  const start = (buffer: AudioBuffer, layerIndex: number) => {
    if (stopped || audio !== context) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = sounds[path].loop;
    source.connect(layerGains[layerIndex] ?? gain!);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (--remaining === 0) {
        stopped = true;
        playing.delete(handle);
        soundGains.delete(handle);
        gain?.disconnect();
        for (const layer of layerGains) layer.disconnect();
      }
    };
    if (offsetSeconds > 0 && buffer.duration > 0) source.start(0, offsetSeconds % buffer.duration);
    else source.start();
  };
  if (envelopes) {
    for (let i = 0; i < filenames.length; i++) { const layer = audio.createGain(); layer.connect(gain!); layerGains.push(layer); }
    handle.setParameter?.('intensity', 0);
  }
  for (const [layerIndex, filename] of filenames.entries()) {
    const buffer = buffers.get(filename);
    if (buffer) start(buffer, layerIndex);
    else void loadSound(filename, audio).then(buffer => start(buffer, layerIndex)).catch((error: unknown) => {
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
  listener.set(0, 0, 0);
}
