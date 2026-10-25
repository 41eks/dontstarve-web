import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createEffect, createMemo, getBoundWatchWorldContent, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { PigKingStateGraph, type PigKingStateInst } from '../../stategraphs/src/SGpigking';
import { actionEntity } from './actionEntity';
import type { LootLaunch } from './lootFling';
import { PlaySound, PreloadSounds } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import definitions from './definitions.json' with { type: 'json' };
import { MiniMapEntity } from './minimapEntity';
import { newEntityId } from './saveRecord';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';

export const PIGKING_ID = 'pigking' as const;

/** pigking.lua has no OnSave: records carry only identity and position. */
export interface PigKingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** What pigking.lua reads from TheWorld and TheCamera. */
export interface PigKingWorld {
  camera: THREE.Camera;
  scheduler: GameTimeScheduler;
  physics: CANNON.World;
  /** Without it every king is active. */
  tickingarea?: TileStateQuery;
  /** SpawnPrefab + Transform:SetPosition + launchitem for each launch factory call. */
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3, launch: () => LootLaunch): void;
}

// pigking.lua launchitem / ontradeforgold.
const TOSS_HEIGHT = 4.5;
const TOSS_DELAY = 2 / 3;
const GOLD = 'goldnugget';
const SOUNDS = ['dontstarve/pig/PigKingThrowGold', 'dontstarve/pig/PigKingHappy', 'dontstarve/pig/PigKingReject'] as const;

/** AnimState:PlayAnimation / PushAnimation: `animover` fires once the queued animations have all ended. */
class PigKingAnimation {
  private queue: { name: string; loop: boolean }[] = [];
  private playingOnce = false;
  private readonly controller: SpriteState;
  private readonly onOver: () => void;
  constructor(controller: SpriteState, onOver: () => void) { this.controller = controller; this.onOver = onOver; }

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

/** pigking.lua fn: obstacle physics, minimap icon, trader, SGpigking and the isnight watcher. */
class PigKing {
  readonly model: THREE.Group;
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  readonly minimap: MiniMapEntity;
  /** pigking.lua trader: tags `trader` while enabled; GIVE discovers it through the actionEntity. */
  readonly trader: Trader<TradeItem>;
  readonly sg: PigKingStateGraph;
  private readonly world: PigKingWorld;
  private readonly tasks = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(world: PigKingWorld, { instance, display }: ReturnType<typeof createPrefabEntity>, getWatchWorldContent?: GetWatchWorldContent) {
    this.world = world; this.instance = instance; this.display = display;
    const model = this.model = display.model;
    // MakeObstaclePhysics(inst, 2, .5): a static capsule on the feet origin.
    MakeObstaclePhysics(instance, 2, .5);
    instance.bindPhysics(world.physics);
    this.minimap = new MiniMapEntity(model.position);
    this.minimap.SetIcon('pigking.png');
    this.minimap.SetPriority(1);

    const entity = actionEntity(model, PIGKING_ID);
    for (const tag of ['king', 'birdblocker', 'antlion_sinkhole_blocker']) entity.addTag(tag);
    const trader = this.trader = new Trader<TradeItem>(entity);
    model.userData.components.trader = trader;
    // Lua only offers GIVE for items with the tradable component.
    trader.SetAbleToAcceptTest(item => item.components?.tradable ? { ok: true } : { ok: false });
    trader.SetAcceptTest(item => (item.components?.tradable?.goldvalue ?? 0) > 0);
    trader.SetOnAccept((giver, item) => {
      const goldvalue = item.components?.tradable?.goldvalue ?? 0;
      if (goldvalue <= 0) return;
      this.sg.goToState('cointoss');
      this.doTaskInTime(TOSS_DELAY, () => this.tradeForGold(goldvalue, giver));
    });
    trader.SetOnRefuse(() => this.sg.goToState('unimpressed'));

    const animation = new PigKingAnimation(instance.sprite, () => this.sg.pushEvent('animover'));
    const inst: PigKingStateInst = {
      mem: { sleeping: false },
      happy: false,
      trader,
      playAnimation: (name, loop) => animation.play(name, loop),
      pushAnimation: (name, loop) => animation.push(name, loop),
      playSound: path => { PlaySound(path, this.groundPosition()); },
      doTaskInTime: (seconds, fn) => this.doTaskInTime(seconds, fn),
    };
    this.sg = new PigKingStateGraph(inst, world.scheduler);
    // pigking.lua OnIsNight, via WatchWorldState("isnight") and an initial call.
    const cycle = getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    if (cycle) {
      const isNight = createMemo(() => cycle.get() === 'night');
      createEffect(() => {
        const night = isNight.get();
        inst.mem.sleeping = night;
        if (night) {
          if (this.sg.hasStateTag('idle')) this.sg.goToState('sleep');
        } else if (this.sg.hasStateTag('sleeping')) this.sg.goToState('wake');
      });
    }
    this.cleanups.push(watchTileActivity(model, world.tickingarea, active => instance.setActive(active)));
  }

  private groundPosition(): THREE.Vector3 { return new THREE.Vector3(this.model.position.x, 0, this.model.position.z); }

  /** inst:DoTaskInTime, cancelled with the king. */
  private doTaskInTime(seconds: number, fn: () => void): () => void {
    const cancel = this.world.scheduler.schedule(seconds, () => { this.tasks.delete(cancel); if (!this.disposed) fn(); });
    this.tasks.add(cancel);
    return () => { cancel(); this.tasks.delete(cancel); };
  }

  /** pigking.lua ontradeforgold: goldvalue nuggets thrown from 4.5 units up, toward the giver. */
  private tradeForGold(goldvalue: number, giver: unknown): void {
    const origin = this.groundPosition();
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

  update(dt: number): void {
    if (this.instance.sprite.loaded) this.instance.sprite.update(dt);
    this.sg.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.cleanups.splice(0)) stop();
    for (const cancel of [...this.tasks]) cancel();
    this.sg.dispose();
    this.trader.Disable();
    this.minimap.dispose();
    this.model.userData.removed = true;
    this.instance.remove(); this.display.dispose();
  }
}

/** pigking.lua: the Pig King, trading gold for tradable items by day and sleeping at night. */
export class PigKingManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly kings = new Map<THREE.Group, PigKing>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: PigKingWorld;
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PigKingWorld) {
    this.scene = scene; this.assetBaseUrl = assetBaseUrl; this.world = world;
    this.getWatchWorldContent = getBoundWatchWorldContent();
  }

  async spawn(position: THREE.Vector3, saved?: PigKingRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Pig kings have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid pig king position');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, definitions.pigKing.archive);
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const [factory] = await Promise.all([this.factoryRequest, PreloadSounds(...SOUNDS)]);
    if (this.disposed) throw new Error('Pig kings have been disposed');
    // The art is lifted once so that its lowest point stands on the entity's feet.
    let lift: number | undefined;
    const create = (animation: string) => {
      const sprite = factory.create({ initialAnimation: animation, name: PIGKING_ID, scale: definitions.pigKing.scale });
      if (lift === undefined) {
        sprite.updateWorldMatrix(true, true);
        lift = -new THREE.Box3().setFromObject(sprite).min.y;
      }
      sprite.children[0].position.y += lift;
      return sprite;
    };
    // AnimState:PlayAnimation("idle", true).
    const entity = createPrefabEntity(PIGKING_ID, { create, release: sprite => factory.disposeSprite(sprite) },
      { name: definitions.pigKing.animationName, billboard: true }, PIGKING_ID);
    const model = entity.display.model;
    model.position.copy(position);
    entity.instance.entityId = saved?.id ?? newEntityId();
    const king = new PigKing(this.world, entity, this.getWatchWorldContent);
    model.userData.pigKing = king;
    this.kings.set(model, king);
    this.scene.add(model);
    return model;
  }

  /** The king's stategraph and sprite advance before physics, like the other world entities' brains. */
  update(dt: number): void {
    if (this.disposed) return;
    for (const king of this.kings.values()) king.update(dt);
  }

  get renderEntities() {
    return [...this.kings.values()].filter(({ instance }) => instance.sprite.loaded)
      .map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.kings.values()].map(({ minimap }) => minimap); }

  /** The king behind a spawned model, for its trader and stategraph. */
  get(model: THREE.Object3D): PigKing | undefined { return this.kings.get(model as THREE.Group); }

  exportRecords(): { prefabId: typeof PIGKING_ID; record: PigKingRecord }[] {
    return [...this.kings].map(([model, king]) => ({ prefabId: PIGKING_ID, record: {
      id: String(king.instance.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const king of this.kings.values()) king.dispose();
    this.kings.clear();
    void this.factoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}
