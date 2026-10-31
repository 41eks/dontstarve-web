import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { CharlieCutscene, WorldSettingsTimer, EntityTracker, ColourTweener } from '../../componets/src/atriumGateSignatures';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { PointOfInterest } from '../../componets/src/statueglommerSignatures';
import { Pickable } from './components/pickable';
import { Trader } from '../../componets/src/trader';
import { PlayerProx } from '../../componets/src/playerprox';
import { Hauntable } from '../../componets/src/hauntable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MiniMapState } from '../../map/src/minimapState';
import { createArchiveEntity, createEmptyEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const ATRIUM_GATE_ID = 'atrium_gate' as const;
/** LAYER_BACKGROUND always draws over LAYER_GROUND (turf, mesh orders [-1, -0.6)); SetSortOrder(-3) only orders it among
 * background decals. A group order would sort it before every turf mesh, so the order goes on the mesh, as for ponds. */
const FLOOR_RENDER_ORDER = -.5 + (-3 - 3) * .01;
export const ATRIUM_GATE_TIMER_NAMES = ['destabilizing', 'destabilizedelay', 'cooldown'] as const;
export type AtriumGateTimerName = typeof ATRIUM_GATE_TIMER_NAMES[number];
export interface AtriumGateTimerSave {
  timeleft: number; paused: boolean; blocklongupdate?: boolean; initial_time?: number;
}
export interface AtriumGateRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: {
    atriumGate?: { vault_key_socketed?: true; can_spawn_charlie_hand_keystone?: true; launch_key?: true };
    pickable?: { picked?: boolean; paused?: boolean; caninteractwith?: true };
    charliecutscene?: { running?: true; gatefixed?: true };
    worldsettingstimer?: { timers: Partial<Record<AtriumGateTimerName, AtriumGateTimerSave>> };
    entitytracker?: { entities: { name: string; GUID: number }[] };
  };
}
export interface AtriumGateWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; physics?: World; scheduler: GameTimeScheduler }

interface Gate {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  floor: ReturnType<typeof createArchiveEntity>;
  blockers: ReturnType<typeof createEmptyEntity>[];
  fx?: ReturnType<typeof createArchiveEntity>;
  pickable: Pickable;
  trader: Trader;
  playerprox: PlayerProx;
  hauntable: Hauntable;
  minimap: MiniMapState;
  save: AtriumGateRecord['components'];
  stopActivity: () => void;
}

const hasTimer = (save: AtriumGateRecord['components'], name: AtriumGateTimerName): boolean =>
  save.worldsettingstimer?.timers[name] !== undefined;
const repaired = (save: AtriumGateRecord['components']): boolean =>
  save.charliecutscene?.gatefixed === true || save.charliecutscene?.running === true;

/** atrium_gate.lua constructor, OnLoad and OnLoadPostPass animation declarations. */
export class AtriumGateManager implements DisplayDrivenPrefabManager<{ prefabId: typeof ATRIUM_GATE_ID; record: AtriumGateRecord }> {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: AtriumGateWorld;
  private readonly assets = new ArchiveSpriteAssets(ATRIUM_GATE_ID);
  private readonly gates = new Map<THREE.Group, Gate>();
  private disposed = false;
  constructor(scene: THREE.Scene, world: AtriumGateWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  /** Instance batches draw upright billboards with a depth prepass; LAYER_BACKGROUND ground art must not join them. */
  private createSprite(animationArchive: string, buildArchives: string[], bank: string, name: string, instanced = true) {
    return (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
      animationArchive, buildArchives, bank, animation: clip.name, loop: clip.loop,
    }, { ...(instanced ? { instancedAnimations: 'all' as const } : {}), name });
  }

  spawn(position: THREE.Vector3, saved?: AtriumGateRecord): THREE.Group {
    if (this.disposed) throw new Error('Atrium gates have been disposed');
    const main = createArchiveEntity(ATRIUM_GATE_ID, { create: this.createSprite('atrium_gate.zip',
      ['atrium_gate.zip', 'atrium_gate_build.zip'], 'atrium_gate', ATRIUM_GATE_ID) },
    { name: 'idle', held: true, billboard: true }, ATRIUM_GATE_ID);
    const { instance, display } = main, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position);
    model.rotation.y = saved?.transform.rotationY ?? 0;
    for (const tag of ['gemsocket', 'stargate', 'give_dolongaction']) instance.addTag(tag);
    MakeObstaclePhysics(instance, 1);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    instance.sprite.playOnce('idle');
    instance.sprite.hideLayer('KEY');
    const save: AtriumGateRecord['components'] = structuredClone(saved?.components ?? { pickable: { picked: true } });
    // OnLoad: SocketVaultKey and CharlieCutscene:OnLoad change appearance before OnLoadPostPass.
    if (save.atriumGate?.vault_key_socketed) instance.sprite.showLayer('KEY');
    // Constructor SetBuild("atrium_gate"): without it, symbols missing there (dreadstone, the repair pieces) would
    // resolve from the listed repaired build. CharlieCutscene:OnLoad switches to atrium_gate_build.
    instance.sprite.setBuildArchive(repaired(save) ? 'atrium_gate_build.zip' : 'atrium_gate.zip');
    const floor = createArchiveEntity('atrium_gate_floor', { create: this.createSprite('atrium_floor.zip',
      ['atrium_floor.zip'], 'atrium_floor', 'atrium_gate_floor', false) },
    { name: 'idle_active', held: true, billboard: false }, 'atrium_gate_floor', undefined, instance.status);
    floor.instance.addTag('DECOR'); floor.instance.addTag('NOCLICK'); floor.instance.persists = false;
    floor.instance.sprite.playOnce('idle_active'); floor.instance.sprite.setGround(0); floor.instance.sprite.setMeshOrder(FLOOR_RENDER_ORDER);
    floor.display.mount(model); this.world.trackDisplay(floor.display);
    const blockers: ReturnType<typeof createEmptyEntity>[] = [];
    const radius = Math.ceil(14.55 / 3), diameter = radius * 2;
    for (let row = -3 * radius; row <= 3 * radius; row += diameter) {
      for (let col = -diameter; col <= diameter; col += diameter) {
        for (const [x, z] of [[row, col], [col, row]]) {
          const child = createEmptyEntity('atrium_gate_terraform_blocker', instance.status);
          child.instance.addTag('FX'); child.instance.persists = false;
          child.instance.position.set(x * WORLD_SCALE, 0, z * WORLD_SCALE);
          child.display.mount(model); blockers.push(child);
        }
      }
    }
    const minimap = instance.minimap;
    const inst = actionEntity(model, ATRIUM_GATE_ID);
    const pickable = new Pickable(model, 'atrium_key', undefined, 1, undefined, undefined,
      { picked: !save.pickable || save.pickable.picked === true, paused: save.pickable?.paused === true }, { scheduler: this.world.scheduler });
    pickable.canInteractWith = save.pickable?.caninteractwith === true;
    const trader = new Trader(inst);
    const playerprox = new PlayerProx({ isValid: () => instance.status.peek() !== 'removed', getPosition: () => instance.position });
    playerprox.SetDist(14.55 * WORLD_SCALE, Math.ceil(14.55 + 4) * WORLD_SCALE);
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, this.world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(prefabInstance(model)!.components, { charliecutscene: new CharlieCutscene(inst), pointofinterest: new PointOfInterest(inst),
      inspectable: new Inspectable(inst), pickable, trader, worldsettingstimer: new WorldSettingsTimer(inst),
      entitytracker: new EntityTracker(inst), colourtweener: new ColourTweener(inst), playerprox, hauntable });
    let fx: Gate['fx'];
    // OnLoadPostPass source priority: destabilizing, cooldown, powered/delayed, then constructor idle.
    if (hasTimer(save, 'destabilizing')) {
      trader.Disable(); pickable.canInteractWith = false;
      instance.sprite.playOnce('overload_pre'); instance.sprite.pushAnimation('overload_loop', true);
      instance.light.set({ radius: 8 * WORLD_SCALE, falloff: .9, intensity: .65, colour: [200 / 255, 140 / 255, 140 / 255] });
      fx = this.createFx(instance, model, 'overload');
    } else if (hasTimer(save, 'cooldown')) {
      trader.Disable(); pickable.canInteractWith = false;
      instance.sprite.start('cooldown');
    } else if (save.pickable?.caninteractwith || hasTimer(save, 'destabilizedelay')) {
      instance.sprite.playOnce('idle_active');
      pickable.canBePicked = true;
      trader.Disable(); pickable.canInteractWith = true;
      if (save.entitytracker?.entities.some(({ name }) => name === 'stalker') || hasTimer(save, 'destabilizedelay')) {
        instance.addTag('intense');
        instance.sprite.start('idle_fight');
        fx = this.createFx(instance, model, 'idle');
      }
      if (hasTimer(save, 'destabilizedelay')) { instance.removeTag('intense'); pickable.canInteractWith = false; }
    }
    minimap.SetIcon(repaired(save)
      ? (save.pickable?.caninteractwith || hasTimer(save, 'destabilizedelay') ? 'atrium_gate_fixed_active.png' : 'atrium_gate_fixed.png')
      : (save.pickable?.caninteractwith || hasTimer(save, 'destabilizedelay') ? 'atrium_gate_active.png' : 'atrium_gate.png'));
    const gate: Gate = { instance, display, floor, blockers, fx, pickable, trader, playerprox, hauntable, minimap, save,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    this.gates.set(model, gate);
    this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }

  private createFx(parent: PrefabInstance<ArchiveSpriteCommands>, model: THREE.Group, state: 'idle' | 'overload'): ReturnType<typeof createArchiveEntity> {
    const fx = createArchiveEntity('atrium_gate_activatedfx', { create: this.createSprite('atrium_gate_overload_fx.zip',
      ['atrium_gate_overload_fx.zip'], 'atrium_gate_overload_fx', 'atrium_gate_activatedfx') },
    { name: `${state}_pre`, billboard: true }, 'atrium_gate_activatedfx', undefined, parent.status);
    fx.instance.persists = false;
    for (const tag of state === 'idle' ? ['FX'] : ['DECOR', 'NOCLICK']) fx.instance.addTag(tag);
    fx.instance.sprite.playOnce(`${state}_pre`); fx.instance.sprite.pushAnimation(`${state}_loop`, true);
    fx.display.mount(model); this.world.trackDisplay(fx.display);
    return fx;
  }
  get renderEntities() { return [...this.gates].filter(([, gate]) => gate.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof ATRIUM_GATE_ID; record: AtriumGateRecord }[] {
    return [...this.gates].map(([model, gate]) => ({ prefabId: ATRIUM_GATE_ID, record: {
      id: String(gate.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: structuredClone(gate.save),
    } }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, gate] of this.gates) {
      gate.stopActivity(); gate.playerprox.dispose(); gate.hauntable.dispose(); gate.pickable.dispose(); gate.trader.dispose();
      gate.floor.instance.remove(); gate.fx?.instance.remove();
      for (const blocker of gate.blockers) blocker.instance.remove();
      model.userData.removed = true; gate.instance.remove();
    }
    this.gates.clear(); this.displays.dispose(); this.assets.dispose();

  }
}
