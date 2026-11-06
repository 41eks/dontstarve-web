import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createEffect, createMemo, WorldContentKey, type GameTimeScheduler, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { PigKingStateGraph, type PigKingStateInst } from '../../stategraphs/src/SGpigking';
import type { LootLaunch } from './lootFling';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { PlaySound } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';
import definitions from './definitions.json' with { type: 'json' };

export const PIGKING_ID = 'pigking' as const;

/** What pigking.lua reads from TheWorld and TheCamera. */
export interface PigKingWorld {
  /** TheCamera:GetDownVec when the giver is gone. */
  camera: THREE.Camera;
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab + Transform:SetPosition + launchitem for each launch factory call. */
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3, launch: () => LootLaunch): void;
}

// pigking.lua launchitem / ontradeforgold.
const TOSS_HEIGHT = 4.5;
const TOSS_DELAY = 2 / 3;
const GOLD = 'goldnugget';

/** AnimState:PlayAnimation / PushAnimation: `animover` fires once the queued animations have all ended. */
class PigKingAnimation {
  private queue: { name: string; loop: boolean }[] = [];
  private playingOnce = false;
  private readonly sprite: SpriteState;
  private readonly onOver: () => void;
  constructor(sprite: SpriteState, onOver: () => void) { this.sprite = sprite; this.onOver = onOver; }

  play(name: string, loop = false): void { this.queue = []; this.run(name, loop); }

  push(name: string, loop = false): void {
    if (this.playingOnce) this.queue.push({ name, loop });
    else this.run(name, loop);
  }

  private run(name: string, loop: boolean): void {
    this.playingOnce = !loop;
    if (loop) this.sprite.start(name);
    else this.sprite.playOnce(name, () => this.finish());
  }

  private finish(): void {
    this.playingOnce = false;
    const next = this.queue.shift();
    if (next) this.run(next.name, next.loop);
    else this.onOver();
  }
}

/**
 * pigking.lua fn: obstacle physics, minimap icon, trader, SGpigking and the isnight watcher. The minigame, hauntable,
 * DynamicShadow, music, camera focus and the special-event trades are not ported.
 */
export class PigKingInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { trader: Trader<TradeItem> };
  readonly pigking: PigKingStateGraph;
  private readonly world: PigKingWorld;
  private readonly tasks = new Set<() => void>();

  constructor(world: PigKingWorld, position: ReadonlyVector3) {
    super(PIGKING_ID, new SpriteState({ name: definitions.pigKing.animationName, billboard: true }), Transform.stationary());
    this.world = world;
    this.setPosition(position.x, 0, position.z);
    this.addTag('blocker'); // MakeObstaclePhysics
    this.sprite.setDepthOffset(true); // SetFinalOffset(1)
    // AddTag("trader") is pristine: the trader below holds it while enabled.
    for (const tag of ['king', 'birdblocker', 'antlion_sinkhole_blocker']) this.addTag(tag);
    this.addTag('inspectable');
    this.minimap.SetPriority(1);

    const trader = new Trader<TradeItem>(this);
    // Lua only offers GIVE for items with the tradable component.
    trader.SetAbleToAcceptTest(item => item.components?.tradable ? { ok: true } : { ok: false });
    trader.SetAcceptTest(item => (item.components?.tradable?.goldvalue ?? 0) > 0);
    trader.SetOnAccept((giver, item) => OnGetItemFromPlayer(this, giver, item));
    trader.SetOnRefuse(() => this.pigking.goToState('unimpressed'));
    Object.assign(this.components, { inspectable: new Inspectable(this), trader });

    const animation = new PigKingAnimation(this.sprite, () => this.pigking.pushEvent('animover'));
    const inst: PigKingStateInst = {
      mem: { sleeping: false },
      happy: false,
      trader,
      playAnimation: (name, loop) => animation.play(name, loop),
      pushAnimation: (name, loop) => animation.push(name, loop),
      playSound: path => { PlaySound(path, this.position); },
      doTaskInTime: (seconds, fn) => this.doTaskInTime(seconds, fn),
    };
    this.pigking = new PigKingStateGraph(inst, world.scheduler);
    this.sg = this.pigking.sg;

    // WatchWorldState("isnight", OnIsNight) and OnIsNight(inst, TheWorld.state.isnight).
    const cleanups: (() => void)[] = [];
    const cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => cleanups.push(stop));
    if (cycle) {
      const isNight = createMemo(() => cycle.get() === 'night');
      cleanups.push(() => isNight.dispose());
      cleanups.push(createEffect(() => OnIsNight(this, inst, isNight.get())));
    }
    this.onRemove(() => {
      cleanups.splice(0).forEach(stop => stop());
      for (const cancel of [...this.tasks]) cancel();
      this.pigking.dispose();
      trader.Disable();
      trader.dispose();
    });
  }

  /** inst:DoTaskInTime, cancelled with the king. */
  doTaskInTime(seconds: number, fn: () => void): () => void {
    const cancel = this.world.scheduler.schedule(seconds, () => { this.tasks.delete(cancel); if (!this.isRemoved) fn(); });
    this.tasks.add(cancel);
    return () => { cancel(); this.tasks.delete(cancel); };
  }

  /** pigking.lua ontradeforgold: goldvalue nuggets thrown from 4.5 units up, toward the giver. */
  tradeForGold(goldvalue: number, giver: unknown): void {
    const origin = new THREE.Vector3(this.position.x, 0, this.position.z);
    const giverPosition = (giver as { position?: THREE.Vector3 } | undefined)?.position;
    let angle: number;
    if (giverPosition) angle = Math.atan2(giverPosition.z - origin.z, giverPosition.x - origin.x);
    else {
      // TheCamera:GetDownVec(): the screen-down direction on the ground.
      const forward = this.world.camera.getWorldDirection(new THREE.Vector3());
      angle = Math.atan2(-forward.z, -forward.x);
    }
    this.world.dropLoot([{ itemId: GOLD, count: goldvalue }], origin, () => ({
      angle: angle + (Math.random() * 60 - 30) * THREE.MathUtils.DEG2RAD,
      height: TOSS_HEIGHT, speed: { min: 2, range: 4 }, ySpeed: { min: 8, range: 2 },
    }));
  }
}

function OnGetItemFromPlayer(inst: PigKingInstance, giver: unknown, item: TradeItem): void {
  const goldvalue = item.components?.tradable?.goldvalue ?? 0;
  if (goldvalue <= 0) return;
  inst.pigking.goToState('cointoss');
  inst.doTaskInTime(TOSS_DELAY, () => inst.tradeForGold(goldvalue, giver));
}

function OnIsNight(inst: PigKingInstance, state: PigKingStateInst, isnight: boolean): void {
  state.mem.sleeping = isnight;
  if (isnight) {
    if (inst.pigking.hasStateTag('idle')) inst.pigking.goToState('sleep');
  } else if (inst.pigking.hasStateTag('sleeping')) inst.pigking.goToState('wake');
}

/** The Prefab pigking.lua returns. */
export function pigKingPrefabs(world: PigKingWorld): Readonly<Record<typeof PIGKING_ID, PrefabEntityDefinition<PigKingInstance>>> {
  return {
    [PIGKING_ID]: {
      fn: position => new PigKingInstance(world, position),
      assets: { animationArchive: definitions.pigKing.archive, buildArchives: [definitions.pigKing.archive], bank: 'Pig_King' },
      // The art stands its lowest point on the entity's feet, as the project draws its standing landmarks.
      alignBottom: true,
      physics: { make: MakeObstaclePhysics, radius: 2, height: .5 },
      minimapIcon: 'pigking.png',
    },
  };
}
