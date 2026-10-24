import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  createAnimatedSprite,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { PigKingStateGraph, type PigKingStateInst } from '../../stategraphs/src/SGpigking';
import { actionEntity } from './actionEntity';
import type { LootLaunch } from './lootFling';
import { PlaySound, PreloadSounds } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import definitions from './definitions.json' with { type: 'json' };

export interface PigKingPrefabOptions {
  position?: THREE.Vector3;
  scale?: number;
}

/** What pigking.lua reads from TheWorld and TheCamera. */
export interface PigKingWorld {
  camera: THREE.Camera;
  scheduler?: GameTimeScheduler;
  /** TheWorld.state.isnight */
  isNight: ReadonlySignal<boolean>;
  /** SpawnPrefab + Transform:SetPosition + launchitem for each launch factory call. */
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3, launch: () => LootLaunch): void;
}

export interface PigKingPrefab {
  body: CANNON.Body;
  standee: THREE.Group;
  /** pigking.lua trader: tags `trader` while enabled; GIVE discovers it through the actionEntity. */
  readonly trader: Trader<TradeItem>;
  /** The inst's stategraph; undefined until the prefab is bound to a world. */
  readonly sg: PigKingStateGraph | undefined;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
  /** Starts the trader, the day/night sleep watcher and the stategraph. */
  bind(world: PigKingWorld): void;
  update(dt: number): void;
  dispose(): void;
}

// pigking.lua launchitem / ontradeforgold.
const TOSS_HEIGHT = 4.5;
const TOSS_DELAY = 2 / 3;
const GOLD = 'goldnugget';

/** AnimState:PlayAnimation / PushAnimation: `animover` fires once the queued animations have all ended. */
class PigKingAnimation {
  private queue: { name: string; loop: boolean }[] = [];
  private playingOnce = false;
  private readonly controller: SpriteAnimationController;
  private readonly onOver: () => void;
  constructor(controller: SpriteAnimationController, onOver: () => void) { this.controller = controller; this.onOver = onOver; }

  play(name: string, loop = false): void { this.queue = []; this.run(name, loop); }

  push(name: string, loop = false): void {
    if (this.playingOnce) this.queue.push({ name, loop });
    else this.run(name, loop);
  }

  private run(name: string, loop: boolean): void {
    this.playingOnce = !loop;
    if (loop) this.controller.start(name);
    else this.controller.playOnce(name, () => this.finish());
  }

  private finish(): void {
    this.playingOnce = false;
    const next = this.queue.shift();
    if (next) this.run(next.name, next.loop);
    else this.onOver();
  }
}

export async function createPigKing(
  assetBaseUrl: string,
  options: PigKingPrefabOptions = {},
): Promise<PigKingPrefab> {
  const standee = await createAnimatedSprite(assetBaseUrl, definitions.pigKing.archive, {
    initialAnimation: definitions.pigKing.animationName,
    name: 'PigKingStandee',
    scale: options.scale ?? definitions.pigKing.scale,
  });
  const position = options.position ?? new THREE.Vector3(0, 0, 25);
  standee.position.copy(position);
  standee.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(standee);
  standee.position.y += position.y - bounds.min.y;

  const animation = standee.userData.animationController as SpriteAnimationController;
  // pigking.lua: MakeObstaclePhysics(inst, 2, .5)
  const body = MakeObstaclePhysics({ x: standee.position.x, y: position.y, z: standee.position.z }, 2, .5);

  // pigking.lua tags, then components/trader.lua with its pigking callbacks.
  const entity = actionEntity(standee, 'pigking');
  // MakeObstaclePhysics(inst, 2): the capsule radius, in scene units.
  standee.userData.physicsRadius = Math.max(...body.shapes.map(shape => shape instanceof CANNON.Sphere ? shape.radius : 0));
  for (const tag of ['king', 'birdblocker', 'antlion_sinkhole_blocker']) entity.addTag(tag);
  const trader = new Trader<TradeItem>(entity);
  trader.Disable();
  standee.userData.components.trader = trader;

  let bound: { world: PigKingWorld; sg: PigKingStateGraph; stopNight: () => void } | undefined;
  let disposed = false;
  const tasks = new Set<() => void>();
  const groundPosition = () => new THREE.Vector3(standee.position.x, 0, standee.position.z);

  const doTaskInTime = (seconds: number, fn: () => void): (() => void) => {
    const scheduler = bound?.world.scheduler;
    if (!scheduler) return () => undefined;
    const cancel = scheduler.schedule(seconds, () => { tasks.delete(cancel); if (!disposed) fn(); });
    tasks.add(cancel);
    return () => { cancel(); tasks.delete(cancel); };
  };

  /** pigking.lua ontradeforgold: goldvalue nuggets thrown from 4.5 units up, toward the giver. */
  const tradeForGold = (world: PigKingWorld, goldvalue: number, giver: unknown) => {
    const origin = groundPosition();
    const giverPosition = (giver as { position?: THREE.Vector3 } | undefined)?.position;
    let angle: number;
    if (giverPosition) angle = Math.atan2(giverPosition.z - origin.z, giverPosition.x - origin.x);
    else {
      // TheCamera:GetDownVec(): the screen-down direction on the ground.
      const forward = world.camera.getWorldDirection(new THREE.Vector3());
      angle = Math.atan2(-forward.z, -forward.x);
    }
    world.dropLoot([{ itemId: GOLD, count: goldvalue }], origin, () => ({
      angle: angle + (Math.random() * 60 - 30) * THREE.MathUtils.DEG2RAD,
      height: TOSS_HEIGHT, speed: { min: 2, range: 4 }, ySpeed: { min: 8, range: 2 },
    }));
  };

  // Lua only offers GIVE for items with the tradable component.
  trader.SetAbleToAcceptTest(item => item.components?.tradable ? { ok: true } : { ok: false });
  trader.SetAcceptTest(item => (item.components?.tradable?.goldvalue ?? 0) > 0);
  trader.SetOnAccept((giver, item) => {
    const goldvalue = item.components?.tradable?.goldvalue ?? 0;
    if (!bound || goldvalue <= 0) return;
    const { world, sg } = bound;
    sg.goToState('cointoss');
    doTaskInTime(TOSS_DELAY, () => tradeForGold(world, goldvalue, giver));
  });
  trader.SetOnRefuse(() => bound?.sg.goToState('unimpressed'));

  return {
    body,
    standee,
    trader,
    get sg() { return bound?.sg; },
    setNormal(cameraWorldQuaternion) {
      standee.quaternion.copy(cameraWorldQuaternion);
    },
    bind(world) {
      if (bound) return;
      disposed = false;
      void PreloadSounds('dontstarve/pig/PigKingThrowGold', 'dontstarve/pig/PigKingHappy', 'dontstarve/pig/PigKingReject');
      let sg: PigKingStateGraph | undefined;
      const pigAnimation = new PigKingAnimation(animation, () => sg?.pushEvent('animover'));
      const inst: PigKingStateInst = {
        mem: { sleeping: false },
        happy: false,
        trader,
        playAnimation: (name, loop) => pigAnimation.play(name, loop),
        pushAnimation: (name, loop) => pigAnimation.push(name, loop),
        playSound: path => { PlaySound(path, groundPosition()); },
        doTaskInTime,
      };
      sg = new PigKingStateGraph(inst, world.scheduler);
      trader.Enable();
      bound = { world, sg, stopNight: () => undefined };
      // pigking.lua OnIsNight, via WatchWorldState("isnight") and an initial call.
      bound.stopNight = createEffect(() => {
        const night = world.isNight.get();
        inst.mem.sleeping = night;
        if (night) {
          if (bound!.sg.hasStateTag('idle')) bound!.sg.goToState('sleep');
        } else if (bound!.sg.hasStateTag('sleeping')) bound!.sg.goToState('wake');
      });
    },
    update(dt) {
      animation.update(dt);
      bound?.sg.update(dt);
    },
    /** Scene teardown: the prefab outlives the scene, so a later bind() starts it again. */
    dispose() {
      if (!bound) return;
      disposed = true;
      bound.stopNight();
      bound.sg.dispose();
      bound = undefined;
      for (const cancel of [...tasks]) cancel();
      trader.Disable();
      animation.start('idle');
    },
  };
}
