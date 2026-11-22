import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { STICK_HEAD_CONFIG } from './generated/stickheads.schema';
import {
  createEffect,
  createMemo,
  createSignal,
  readonlySignal,
  WorldContentKey,
  type Memo,
} from '@dontstarve-web/signals';
import { FliesController } from './flies';
import { createArchiveEntity, PrefabInstance } from './prefabInstance';
import type { ReadonlyVector3 } from './transform';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { PlaySound } from './sound';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const PIG_HEAD_ID = 'pighead' as const;
export type PigHeadId = typeof PIG_HEAD_ID;
export const MERM_HEAD_ID = 'mermhead' as const;
export type MermHeadId = typeof MERM_HEAD_ID;
type StickHeadId = PigHeadId | MermHeadId;
type StickHeadAppearance = Pick<
  (typeof STICK_HEAD_CONFIG)[StickHeadId],
  'child' | 'idleAnimation' | 'wakeAnimation' | 'idleAwake'
>;

function buildingDeclaration(id: StickHeadId): BuildingDeclaration {
  const { archive, idleAnimation } = STICK_HEAD_CONFIG[id];
  return { ...definitions.animatedBuildings[id], archive, idleAnimation };
}

const DECLARATIONS: Readonly<Record<StickHeadId, BuildingDeclaration>> = {
  [PIG_HEAD_ID]: buildingDeclaration(PIG_HEAD_ID),
  [MERM_HEAD_ID]: buildingDeclaration(MERM_HEAD_ID),
};

/** stickheads.lua MakePlacer(name.."_placer", bankandbuild, bankandbuild, "idle_asleep"). */
export const STICK_HEAD_PLACERS = {
  [PIG_HEAD_ID]: buildingPlacer(DECLARATIONS[PIG_HEAD_ID], STICK_HEAD_CONFIG[PIG_HEAD_ID].bank),
  [MERM_HEAD_ID]: buildingPlacer(DECLARATIONS[MERM_HEAD_ID], STICK_HEAD_CONFIG[MERM_HEAD_ID].bank),
};

const SHOWN = readonlySignal(createSignal(true));

/** inst.awake plus the isfullmoon watcher; `awake` is never saved and is rebuilt from the world on load. */
class StickHead {
  private awake = false;
  private readonly cleanups: (() => void)[] = [];
  private readonly fliesController?: FliesController;
  private readonly fullMoon?: Memo<boolean>;
  readonly flies: ReturnType<typeof createArchiveEntity>;
  private readonly inst: PrefabInstance;
  private readonly appearance: StickHeadAppearance;

  constructor(
    inst: PrefabInstance,
    appearance: StickHeadAppearance,
    world: PrefabWorldContext,
    sprites: SpriteResources,
  ) {
    this.inst = inst;
    this.appearance = appearance;
    const { child } = appearance;
    // create_common: SpawnChild("flies") beside the head, drawn from the world's shared flies archive.
    const fliesSource = sprites.archive(
      { animationArchive: 'flies.zip', buildArchives: ['flies.zip'], bank: 'flies' },
      { dynamicParent: true },
    );
    this.flies = createArchiveEntity(
      child,
      fliesSource,
      { name: 'swarm_pre', billboard: true },
      child,
      flies => {
        flies.persists = false;
      },
      inst.status,
    );
    const flies = this.flies.display.model;
    inst.sprite.attachFx(child, {
      sprite: this.flies.instance.sprite,
      display: this.flies.display,
      active: SHOWN,
      sortLayer: 2,
    });
    // The decorative child must not enlarge the head's pickup target, whenever its sprite is rebuilt.
    this.cleanups.push(
      createEffect(() => {
        this.flies.instance.sprite.art.get();
        flies.traverse(object => {
          object.raycast = () => {};
        });
      }),
    );
    if (world.scheduler) {
      this.fliesController = new FliesController(
        this.flies.instance,
        inst.position,
        world.scheduler,
        world.getWatchWorldContent,
      );
    }
    // The head never moves, so its private tile key gates the moon and phase inputs by tickingarea: outside it they hold their last value.
    const area = inst.transform.getTileActivity(world.tickingarea, stop => this.cleanups.push(stop));
    const options = area ? { active: area } : undefined;
    const moon = world.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop), options);
    const cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop), options);
    if (moon && cycle) {
      // worldstate.lua: isfullmoon = isnight and moonphase == "full". The first run is the constructor's OnFullMoon call.
      const fullMoon = createMemo(() => moon.get().phase === 'full' && cycle.get() === 'night');
      this.fullMoon = fullMoon;
      // The memo and effect read the local signals, so their stop callbacks release them.
      createEffect(() => this.onFullMoon(fullMoon.get()));
    }
  }

  get isFullMoon(): boolean {
    return this.fullMoon?.peek() ?? false;
  }
  get idle(): string {
    const { idleAwake, idleAnimation } = this.appearance;
    return this.awake ? idleAwake : idleAnimation;
  }

  /** OnFullMoon: wake or sleep, then settle on the idle pose. */
  onFullMoon(isfullmoon: boolean): void {
    if (this.inst.hasTag('burnt')) {
      return;
    }
    const { sprite } = this.inst;
    if (isfullmoon === this.awake) {
      return;
    }
    this.awake = isfullmoon;
    sprite.playOnce(isfullmoon ? this.appearance.wakeAnimation : 'sleep', () => sprite.playOnce(this.idle));
  }

  /** OnWorked: hit, then back to the current idle pose. */
  hit(): void {
    const { sprite } = this.inst;
    sprite.playOnce('hit', () => sprite.start(this.idle));
  }

  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop());
    this.fliesController?.dispose();
    this.inst.sprite.detachFx(this.appearance.child);
    this.flies.instance.remove();
    this.flies.display.dispose();
  }
}

function onworked(inst: StickHeadInstance): void {
  if (!inst.hasTag('burnt')) {
    inst.head.hit();
  }
}

function onhammered(inst: StickHeadInstance): void {
  if (inst.components.burnable?.IsBurning()) {
    inst.components.burnable.Extinguish();
  }
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  if (inst.head.isFullMoon) {
    inst.components.lootdropper!.SpawnLootPrefab('nightmarefuel');
  }
  inst.components.lootdropper!.DropLoot();
  inst.remove();
}

/** stickheads.lua create_common: both heads share work, burn, loot and full-moon behaviour; only art and recipe loot differ. */
export class StickHeadInstance extends PrefabInstance {
  readonly head: StickHead;

  constructor(id: StickHeadId, world: PrefabWorldContext, position: ReadonlyVector3, sprites: SpriteResources) {
    const config = STICK_HEAD_CONFIG[id];
    super(id, new SpriteState({ name: config.idleAnimation, billboard: true }));
    const { fire, scheduler } = world;
    if (!fire || !scheduler) {
      throw new Error("A stick head needs the world's fire effects and scheduler");
    }
    this.worldServices = world;
    // The head's tile key is taken where it stands.
    this.setPosition(position.x, 0, position.z);
    MakeBuildingPersist(this);
    const { OnSave: saveBuilding } = this;
    this.OnSave = (inst, data) => {
      saveBuilding!(inst, data);
      onsaveBurnt(inst, data);
    };
    this.OnLoad = onloadBurnt;
    for (const tag of config.tags) {
      this.addTag(tag);
    }
    const workable = addComponent(this, 'workable', Workable);
    workable.SetWorkAction(config.workable.action);
    workable.SetWorkLeft(config.workable.workLeft);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
    const head = (this.head = new StickHead(this, config, world, sprites));
    this.onRemove(() => head.dispose());
    // MakeSmallBurnable and MakeSmallPropagator bind the fire behavior to this instance.
    const burn = new BurnableBinding(
      this,
      {
        ...config.burnable,
        propagator: 'small',
        onExtinguish: () => {
          PlaySound('dontstarve/common/fireOut', this.position);
        },
        onBurnt: () => {
          DefaultBurntStructureFn(this);
          burn.dispose();
        },
      },
      { fire, scheduler },
    );
    this.onRemove(() => burn.dispose());
  }
}

/** The Prefab table stickheads.lua returns for the two heads; the placers are the build flow's. */
export function stickHeadPrefabs(world: PrefabWorldContext) {
  const define = (id: StickHeadId) =>
    buildingPrefab(
      DECLARATIONS[id],
      STICK_HEAD_CONFIG[id].bank,
      undefined,
      (position, sprites) => new StickHeadInstance(id, world, position, sprites),
      world,
    );
  return { [PIG_HEAD_ID]: define(PIG_HEAD_ID), [MERM_HEAD_ID]: define(MERM_HEAD_ID) };
}
