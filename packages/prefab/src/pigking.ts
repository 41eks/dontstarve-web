import type { TheCamera } from './followcamera';
import { addComponent } from './components';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createEffect, createMemo, WorldContentKey, type GameTimeScheduler, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { AnimState } from '../../componets/src/animstate';
import { animationLengths, isTimedArchive } from './animationTimings';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { PigKingStateGraph, type PigKingStateInst } from '../../stategraphs/src/SGpigking';
import type { LootLaunch } from '../../componets/src/inventoryphysics';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import type { SoundEmitter } from './soundEmitter';
import definitions from './definitions.json' with { type: 'json' };

export const PIGKING_ID = 'pigking' as const;

/** What pigking.lua reads from TheWorld and TheCamera. */
export interface PigKingWorld {
  /** TheCamera:GetDownVec when the giver is gone. */
  TheCamera: TheCamera;
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab + Transform:SetPosition + launchitem for each launch factory call. */
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3, launch: () => LootLaunch): void;
}

// pigking.lua launchitem / ontradeforgold.
const TOSS_HEIGHT = 4.5;
const TOSS_DELAY = 2 / 3;
const GOLD = 'goldnugget';

/** pig_king's clips, from the source anim.bin. */
const PIG_KING_ARCHIVE = definitions.pigKing.archive;
if (!isTimedArchive(PIG_KING_ARCHIVE)) throw new Error(`No animation timings for ${PIG_KING_ARCHIVE}`);
const ANIMATION_LENGTHS = animationLengths(PIG_KING_ARCHIVE);

/**
 * pigking.lua fn: obstacle physics, minimap icon, trader, SGpigking and the isnight watcher. The minigame, hauntable,
 * DynamicShadow, music, camera focus and the special-event trades are not ported.
 */
export class PigKingInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { trader: Trader<TradeItem> };
  declare SoundEmitter: SoundEmitter;
  readonly pigking: PigKingStateGraph;
  /** inst.sg.mem, which SGpigking reads across its states. */
  readonly mem: PigKingStateInst['mem'] = { sleeping: false };
  /** inst.happy, set by SGpigking's cointoss for five seconds. */
  happy = false;
  private readonly world: PigKingWorld;
  /** inst.AnimState's playback: clips end after their source length in game time, whether or not their art is drawn. */
  readonly animstate: AnimState;

  constructor(world: PigKingWorld, position: ReadonlyVector3) {
    super(PIGKING_ID, new SpriteState({ name: definitions.pigKing.animationName, billboard: true }));
    this.world = world;
    this.BindScheduler(world.scheduler);
    this.setPosition(position.x, 0, position.z);
    this.addTag('blocker'); // MakeObstaclePhysics
    this.sprite.setDepthOffset(true); // SetFinalOffset(1)
    // AddTag("trader") is pristine: the trader below holds it while enabled.
    for (const tag of ['king', 'birdblocker', 'antlion_sinkhole_blocker']) this.addTag(tag);
    this.addTag('inspectable');
    this.minimap.SetPriority(1);

    const trader = addComponent(this, 'trader', Trader<TradeItem>);
    // Lua only offers GIVE for items with the tradable component.
    trader.SetAbleToAcceptTest((_inst, item) => item.components?.tradable ? { ok: true } : { ok: false });
    trader.SetAcceptTest((_inst, item) => (item.components?.tradable?.goldvalue ?? 0) > 0);
    trader.SetOnAccept((_inst, giver, item) => OnGetItemFromPlayer(this, giver, item));
    trader.SetOnRefuse(() => this.pigking.goToState('unimpressed'));
    addComponent(this, 'inspectable', Inspectable);

    this.animstate = new AnimState(world.scheduler, ANIMATION_LENGTHS, event => this.pigking.pushEvent(event));
    this.AddSoundEmitter();
    this.pigking = new PigKingStateGraph(this, world.scheduler);
    this.SetStateGraph(() => this.pigking.sg);

    // WatchWorldState("isnight", OnIsNight) and OnIsNight(inst, TheWorld.state.isnight).
    const cleanups: (() => void)[] = [];
    const cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => cleanups.push(stop));
    if (cycle) {
      const isNight = createMemo(() => cycle.get() === 'night');
      cleanups.push(() => isNight.dispose());
      cleanups.push(createEffect(() => OnIsNight(this, isNight.get())));
    }
    this.onRemove(() => {
      cleanups.splice(0).forEach(stop => stop());
      this.animstate.dispose();
      this.pigking.dispose();
      trader.Disable();
      trader.dispose();
    });
  }

  /** AnimState:PlayAnimation / PushAnimation on the logical clip, whose end is SGpigking's animover, and the drawn one. */
  // conventions-allow instance-method: the engine's AnimState calls SGpigking makes on its inst
  playAnimation(name: string, loop = false): void {
    this.animstate.PlayAnimation(name, loop);
    if (loop) this.sprite.start(name); else this.sprite.playOnce(name);
  }
  // conventions-allow instance-method: the engine's AnimState calls SGpigking makes on its inst
  pushAnimation(name: string, loop = false): void {
    this.animstate.PushAnimation(name, loop);
    this.sprite.pushAnimation(name, loop);
  }

  /** pigking.lua ontradeforgold: goldvalue nuggets thrown from 4.5 units up, toward the giver. */
  tradeForGold(goldvalue: number, giver: unknown): void {
    const origin = new THREE.Vector3(this.position.x, 0, this.position.z);
    const giverPosition = (giver as { position?: THREE.Vector3 } | undefined)?.position;
    let angle: number;
    if (giverPosition) angle = Math.atan2(giverPosition.z - origin.z, giverPosition.x - origin.x);
    else {
      const down = this.world.TheCamera.GetDownVec();
      angle = Math.atan2(down.z, down.x);
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
  inst.DoTaskInTime(TOSS_DELAY, () => inst.tradeForGold(goldvalue, giver));
}

function OnIsNight(inst: PigKingInstance, isnight: boolean): void {
  inst.mem.sleeping = isnight;
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
