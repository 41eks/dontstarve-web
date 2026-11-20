import { addComponent } from './components';
import {
  createEffect,
  createMemo,
  WorldContentKey,
  type GetWatchWorldContent,
  type HandEquipment,
  type ReadonlySignal,
  type TileStateQuery,
  type WorldContentSignal,
  type WorldPhase,
} from '@dontstarve-web/signals';
import { ItemEntity, registerItemEntityClass } from '@dontstarve-web/inventory';
import type { EntityTask } from './prefabInstance';
import type { ItemPrefabWorld } from './groundPrefab';
import { bindItemWorld, dropStackIndividually, type ItemPrefabDefinition } from './groundItems';
import { Workable, type Worker } from '../../componets/src/workable';
import { PlayerProx } from '../../componets/src/playerprox';
import type { Inspectable } from '../../componets/src/inspectable';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { ToolMouseTarget } from './toolMouseTarget';
import { WORLD_SCALE } from './tile';

export const FIREFLIES_ID = 'fireflies';
const INTENSITY = 0.5;
/** fn's inst.Light: SetFalloff(1), SetRadius(1), SetColour(180/255, 195/255, 150/255), at full INTENSITY. */
export const FIREFLIES_LIGHT = {
  radius: WORLD_SCALE,
  intensity: INTENSITY,
  falloff: 1,
  colour: [180 / 255, 195 / 255, 150 / 255] as const,
};

export interface FirefliesWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  tickingarea?: TileStateQuery;
  handEquipment?: ReadonlySignal<HandEquipment | null>;
}

type FirefliesComponents = ItemEntity['components'] & {
  inspectable: Inspectable;
  workable: Workable;
  playerprox: PlayerProx<FirefliesEntity>;
};

/** fireflies.lua's inst: the fields its fn and callbacks set on it. */
export class FirefliesEntity extends ItemEntity {
  declare readonly components: FirefliesComponents;
  /** inst._fadeval (net_float): the light's intensity. */
  _fadeval = 0;
  /** inst._faderate (net_smallbyte): 0 is an immediate fadeout, 1–31 a fadein, 32–63 a fadeout. */
  _faderate = 0;
  _fadetask?: EntityTask;
  _disableworktask?: EntityTask;
  /** TheWorld.state's phase, whose isnight updatelight reads. */
  _worldphase?: WorldContentSignal<WorldPhase>;
}
registerItemEntityClass(FIREFLIES_ID, (...item) => new FirefliesEntity(...item));

function randomizefadein(): number {
  return 1 + Math.floor(Math.random() * 31);
}

function randomizefadeout(): number {
  return 32 + Math.floor(Math.random() * 32);
}

function immediatefadeout(): number {
  return 0;
}

/**
 * immediate fadeout -> 0; randomize fadein -> INTENSITY * FRAMES / (3 + math.random() * 2); randomize fadeout ->
 * -INTENSITY * FRAMES / (.75 + math.random()).
 */
function resolvefaderate(x: number): number {
  return x === 0
    ? 0
    : x < 32
      ? (INTENSITY * FRAMES) / (3 + (x - 1) / 15)
      : (INTENSITY * FRAMES) / ((32 - x) / 31 - 0.75);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** inst.Light:Enable(enable); the light's intensity is always the last _fadeval set on it. */
function EnableLight(inst: FirefliesEntity, enable: boolean): void {
  inst.light.set(enable ? { ...FIREFLIES_LIGHT, intensity: inst._fadeval } : null);
}

/** inst.Light:SetIntensity(intensity), on the enabled light. */
function SetLightIntensity(inst: FirefliesEntity, intensity: number): void {
  if (inst.light.peek()) {
    inst.light.set({ ...FIREFLIES_LIGHT, intensity });
  }
}

function cancelworktask(inst: FirefliesEntity): void {
  if (inst._disableworktask !== undefined) {
    inst._disableworktask.Cancel();
    inst._disableworktask = undefined;
  }
}

function disableworkcb(inst: FirefliesEntity): void {
  inst.components.workable.SetWorkable(false);
}

function disablework(inst: FirefliesEntity): void {
  cancelworktask(inst);
  inst._disableworktask = inst.DoTaskInTime(1.5 + Math.random(), disableworkcb);
}

function enablework(inst: FirefliesEntity): void {
  cancelworktask(inst);
  inst.components.workable.SetWorkable(true);
}

function updatefade(inst: FirefliesEntity, rate: number): void {
  inst._fadeval = clamp(inst._fadeval + rate, 0, INTENSITY);

  SetLightIntensity(inst, inst._fadeval);

  if (rate === 0 || (rate < 0 && inst._fadeval <= 0) || (rate > 0 && inst._fadeval >= INTENSITY)) {
    inst._fadetask?.Cancel();
    inst._fadetask = undefined;
    if (inst._fadeval <= 0) {
      inst.addTag('NOCLICK');
      disablework(inst);
      EnableLight(inst, false);
    }
  }
}

function fadein(inst: FirefliesEntity): void {
  if (resolvefaderate(inst._faderate) <= 0) {
    inst.removeTag('NOCLICK');
    enablework(inst);
    EnableLight(inst, true);
    inst.AnimState.PlayAnimation('swarm_pre');
    inst.AnimState.PushAnimation('swarm_loop', true);
    inst._faderate = randomizefadein();
    inst._fadetask?.Cancel();
    const rate = resolvefaderate(inst._faderate) * clamp(1 - inst._fadeval / INTENSITY, 0, 1);
    inst._fadetask = inst.DoPeriodicTask(FRAMES, inst => updatefade(inst, rate));
  }
}

/**
 * swarm_pst ends on an empty frame and nothing is pushed after it: its sprite is released rather than drawing that frame
 * until the next fadein.
 */
function onswarmpstover(inst: FirefliesEntity): void {
  if (resolvefaderate(inst._faderate) <= 0) {
    inst.sprite.clearAnimation();
  }
}

function fadeout(inst: FirefliesEntity): void {
  if (resolvefaderate(inst._faderate) > 0) {
    // Set before PlayAnimation: an undrawn swarm_pst completes at once and reads it.
    inst._faderate = randomizefadeout();
    inst.sprite.playOnce('swarm_pst', () => onswarmpstover(inst));
    inst._fadetask?.Cancel();
    const rate = resolvefaderate(inst._faderate) * clamp(inst._fadeval / INTENSITY, 0, 1);
    inst._fadetask = inst.DoPeriodicTask(FRAMES, inst => updatefade(inst, rate));
  }
}

function updatelight(inst: FirefliesEntity): void {
  if (
    inst._worldphase?.peek() === 'night' &&
    !inst.components.playerprox.IsPlayerClose() &&
    inst.components.inventoryitem.owner === null
  ) {
    fadein(inst);
  } else {
    fadeout(inst);
  }
}

function ondropped(inst: FirefliesEntity): void {
  inst.components.workable.SetWorkLeft(1);
  inst._fadeval = 0;
  inst._faderate = immediatefadeout();
  fadein(inst);
  inst.DoTaskInTime(2 + Math.random(), updatelight);
}

function onputininventory(inst: FirefliesEntity): void {
  if (inst._fadetask !== undefined) {
    inst._fadetask.Cancel();
    inst._fadetask = undefined;
  }
  inst._fadeval = 0;
  inst._faderate = immediatefadeout();
  SetLightIntensity(inst, 0);
  EnableLight(inst, false);
}

function onworked(inst: FirefliesEntity, worker: Worker): void {
  worker.components?.inventory?.GiveItem?.(inst, inst.getPosition().clone());
}

function getstatus(inst: FirefliesEntity): string | undefined {
  if (inst.components.inventoryitem.owner !== null) {
    return 'HELD';
  }
  return undefined;
}

function OnIsNight(inst: FirefliesEntity): void {
  inst.DoTaskInTime(2 + Math.random(), updatelight);
}

/** inst:WatchWorldState("isnight", fn): fn runs each time isnight changes, until the inst is removed. */
function WatchIsNight(inst: FirefliesEntity, fn: (inst: FirefliesEntity) => void): void {
  const phase = inst._worldphase;
  if (!phase) {
    return;
  }
  const isnight = createMemo(() => phase.get() === 'night');
  let wasnight = isnight.peek();
  const stop = createEffect(() => {
    const night = isnight.get();
    if (night !== wasnight) {
      wasnight = night;
      fn(inst);
    }
  });
  inst.onRemove(() => {
    stop();
    isnight.dispose();
  });
}

/**
 * fireflies.lua: a bank and build but nothing played until fadein, so no sprite is built until a clip plays; every
 * swarm_loop joins one instance batch.
 */
export function firefliesPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  const firefliesWorld = world.firefliesWorld;
  return {
    [FIREFLIES_ID]: {
      fn: () => {
        const inst = world.newItem(FIREFLIES_ID);
        if (!(inst instanceof FirefliesEntity)) {
          throw new Error('SpawnPrefab("fireflies") made no fireflies');
        }
        inst.sprite.resetPresentation({ name: 'swarm_pre', none: true, billboard: true });
        bindItemWorld(inst, world);
        // fn's own updatelight schedules the fade on TheWorld's scheduler.
        inst.BindScheduler(world.scheduler);

        // SetBloomEffectHandle("shaders/anim.ksh"): its luminous swarm art stays visible at night.
        inst.sprite.setLightOverride(1);

        inst.addTag('firefly');
        inst.addTag('cattoyairborne');
        inst.addTag('flying');
        inst.addTag('NOBLOCK');
        inst.addTag('NOCLICK');

        const playerprox = addComponent(
          inst,
          'playerprox',
          PlayerProx<FirefliesEntity>,
          firefliesWorld.getWatchWorldContent,
        );

        inst.components.inspectable.getstatus = () => getstatus(inst);

        const workable = addComponent(inst, 'workable', Workable);
        workable.SetWorkAction('NET');
        workable.SetWorkLeft(1);
        workable.SetOnFinishCallback(onworked);
        workable.SetWorkable(false);

        // stackable.forcedropsingle: a dropped stack lets its insects go one at a time.
        inst.ListenForEvent('ondropped', inst => dropStackIndividually(inst, world));

        const inventoryitem = inst.components.inventoryitem;
        inventoryitem.SetOnDroppedFn(ondropped);
        inventoryitem.SetOnPutInInventoryFn(onputininventory);
        inventoryitem.canbepickedup = false;
        inventoryitem.canbepickedupalive = true;

        playerprox.SetDist(3 * WORLD_SCALE, 5 * WORLD_SCALE);
        playerprox.SetOnPlayerNear(updatelight);
        playerprox.SetOnPlayerFar(updatelight);

        inst._worldphase = firefliesWorld.getWatchWorldContent?.(WorldContentKey.Cycle, stop => inst.onRemove(stop));
        WatchIsNight(inst, OnIsNight);

        updatelight(inst);

        return inst;
      },
      assets: { animationArchive: 'fireflies.zip', buildArchives: ['fireflies.zip'], bank: 'fireflies' },
      assetOptions: { instancedAnimations: ['swarm_loop'] },
      // AnimState:SetRayTestOnBB(true): the pointer tests the swarm's bounding box rather than its sparse particles.
      rayTestOnBB: true,
      onSpawned: inst => {
        world.configureItem(inst);
        // ACTIONS.NET needs a net in hand: the swarm is a mouse target only while the held tool could catch it.
        new ToolMouseTarget(inst, firefliesWorld.handEquipment ?? world.handEquipment);
      },
    },
  };
}
