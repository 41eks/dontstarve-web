import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteController } from '@dontstarve-web/animation/sprite';
import { BathBombable } from '../../componets/src/bathbombable';
import { Heater } from '../../componets/src/heater';
import { actionEntity } from './actionEntity';
import { setPrefabLocalLight } from './localLight';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';

export const HOTSPRING_ID = 'hotspring' as const;
/** tuning.lua HOTSPRING_HEAT. */
export const HOTSPRING_HEAT = { ACTIVE: 90, PASSIVE: 45 } as const;
/** tuning.lua HOTSPRING_GLOW with prefabs/hotspring.lua's colour, radius in scene units. */
export const HOTSPRING_LIGHT = { radius: 2 * WORLD_SCALE, intensity: .75, falloff: .75,
  colour: [.1, 1.6, 2] as const };
/** hotspring.lua MakePondPhysics(inst, 1), in scene units. */
export const HOTSPRING_RADIUS = WORLD_SCALE;

export interface HotspringSaveState { isbathbombed?: true; }
export interface HotspringRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { hotspring?: HotspringSaveState };
}

/** hotspring.lua's heat, light and bathbombable branches; glass, bathing and steam FX are separate Lua branches. */
class Hotspring {
  readonly heater: Heater;
  readonly bathbombable: BathBombable;
  readonly body: CANNON.Body;
  private readonly model: THREE.Group;
  constructor(model: THREE.Group, saved?: HotspringSaveState) {
    this.model = model;
    const inst = actionEntity(model, HOTSPRING_ID);
    for (const tag of ['watersource', 'antlion_sinkhole_blocker', 'birdblocker']) inst.addTag(tag);
    this.heater = new Heater(inst);
    this.heater.SetHeatFn(() => this.getHeat());
    this.bathbombable = new BathBombable(inst);
    this.bathbombable.SetOnBathBombedFn(() => this.onBathBombed(false));
    inst.components.heater = this.heater; inst.components.bathbombable = this.bathbombable;
    this.body = MakeObstaclePhysics(model.position, 1);
    setPrefabLocalLight(model, null); // Light:Enable(false)
    // OnLoad: `bathbombable:OnBathBombed()` with POPULATING set.
    if (saved?.isbathbombed) { this.bathbombable.OnBathBombed(); this.onBathBombed(true); }
  }
  private getHeat(): number {
    if (this.bathbombable.is_bathbombed) { this.heater.SetThermics(true, false); return HOTSPRING_HEAT.ACTIVE; }
    if (this.bathbombable.can_be_bathbombed) { this.heater.SetThermics(true, false); return HOTSPRING_HEAT.PASSIVE; }
    this.heater.SetThermics(false, false);
    return 0;
  }
  private onBathBombed(populating: boolean): void {
    setPrefabLocalLight(this.model, HOTSPRING_LIGHT);
    const controller = this.model.userData.animationController as SpriteController;
    if (populating) { controller.start('glow_loop'); return; }
    controller.playOnce('bath_bomb', () => controller.playOnce('glow_pre', () => controller.start('glow_loop')));
  }
  exportSave(): HotspringSaveState { return this.bathbombable.is_bathbombed ? { isbathbombed: true } : {}; }
  dispose(): void {
    this.heater.dispose(); this.bathbombable.dispose();
    const components = this.model.userData.components;
    delete components.heater; delete components.bathbombable;
    setPrefabLocalLight(this.model, null);
  }
}

/** Source heat, light and bath bomb interaction: the glass, bathing pool and steam branches are not ported. */
export class HotspringManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly springs = new Map<THREE.Group, Hotspring>();
  private readonly scene: THREE.Scene;
  private readonly physics: CANNON.World;
  private readonly baseUrl: string;
  private disposed = false;
  constructor(scene: THREE.Scene, physics: CANNON.World, baseUrl: string) {
    this.scene = scene; this.physics = physics; this.baseUrl = baseUrl;
  }
  private factory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Hotspring manager has been disposed'));
    if (this.factoryRequest) return this.factoryRequest;
    const request = this.factoryRequest = createAnimatedSpriteFactory(this.baseUrl, 'crater_pool.zip');
    void request.catch(() => { this.factoryRequest = undefined; });
    return request;
  }
  async spawn(position: THREE.Vector3, saved?: HotspringRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid hotspring position');
    const factory = await this.factory();
    if (this.disposed) throw new Error('Hotspring manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle', name: HOTSPRING_ID });
    model.position.copy(position); model.userData.billboard = false;
    // LAYER_BACKGROUND decor lies on the ground like ponds; the entity root stays at the ground origin.
    const visual = model.children[0]; visual.rotation.x = -Math.PI / 2; visual.position.y = .01;
    visual.children[0].renderOrder = -.5;
    Object.assign(model.userData, { prefab: HOTSPRING_ID, entityId: saved?.id ?? newEntityId(),
      noWetPrefix: true, deploySmartRadius: 1.5 * WORLD_SCALE, physicsRadius: HOTSPRING_RADIUS });
    const spring = new Hotspring(model, saved?.components.hotspring);
    model.userData.hotspring = spring; model.userData.physicsBody = spring.body;
    model.userData.remove = () => this.remove(model);
    this.springs.set(model, spring); this.scene.add(model); this.physics.addBody(spring.body);
    return model;
  }
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    for (const model of this.springs.keys()) (model.userData.animationController as SpriteController).update(dt);
  }
  exportRecords(): { prefabId: typeof HOTSPRING_ID; record: HotspringRecord }[] {
    return [...this.springs].map(([model, spring]) => ({ prefabId: HOTSPRING_ID, record: {
      id: model.userData.entityId as string,
      transform: { position: model.position.toArray(), rotationY: 0 }, components: { hotspring: spring.exportSave() },
    } }));
  }
  remove(model: THREE.Group): void {
    const spring = this.springs.get(model);
    if (!spring) return;
    this.springs.delete(model); model.userData.removed = true;
    spring.dispose(); this.physics.removeBody(spring.body); model.removeFromParent();
    void this.factoryRequest?.then(factory => factory.disposeSprite(model));
  }
  dispose(): void {
    if (this.disposed) return;
    for (const model of [...this.springs.keys()]) this.remove(model);
    this.disposed = true;
    void this.factoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}
