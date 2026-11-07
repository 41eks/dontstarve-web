import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal, WorldContentKey, type Memo } from '@dontstarve-web/signals';
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

const DECLARATIONS: Readonly<Record<StickHeadId, BuildingDeclaration>> = {
    [PIG_HEAD_ID]: definitions.animatedBuildings.pighead,
    [MERM_HEAD_ID]: definitions.animatedBuildings.mermhead,
};

/** stickheads.lua MakePlacer(name.."_placer", bankandbuild, bankandbuild, "idle_asleep"). */
export const STICK_HEAD_PLACERS = {
    [PIG_HEAD_ID]: buildingPlacer(DECLARATIONS[PIG_HEAD_ID]),
    [MERM_HEAD_ID]: buildingPlacer(DECLARATIONS[MERM_HEAD_ID]),
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

    constructor(inst: PrefabInstance, world: PrefabWorldContext, sprites: SpriteResources) {
        this.inst = inst;
        // create_common: SpawnChild("flies") beside the head, drawn from the world's shared flies archive.
        const fliesSource = sprites.archive({ animationArchive: 'flies.zip', buildArchives: ['flies.zip'], bank: 'flies' }, { dynamicParent: true });
        this.flies = createArchiveEntity('flies', fliesSource, { name: 'swarm_pre', billboard: true }, 'flies', flies => { flies.persists = false; }, inst.status);
        const flies = this.flies.display.model;
        inst.sprite.attachFx('flies', { sprite: this.flies.instance.sprite, display: this.flies.display, active: SHOWN, sortLayer: 2 });
        // The decorative child must not enlarge the head's pickup target, whenever its sprite is rebuilt.
        this.cleanups.push(createEffect(() => {
            this.flies.instance.sprite.art.get();
            flies.traverse(object => { object.raycast = () => {}; });
        }));
        // OnEntitySleep/OnEntityWake: the swarm sleeps and wakes with the head.
        const status = watchSignal(inst.status, stop => this.cleanups.push(stop));
        this.cleanups.push(createEffect(() => { const value = status.get(); if (value !== 'removed') this.flies.instance.setActive(value === 'active'); }));
        if (world.scheduler) this.fliesController = new FliesController(this.flies.instance, inst.position, world.scheduler, world.getWatchWorldContent);
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

    get isFullMoon(): boolean { return this.fullMoon?.peek() ?? false; }
    get idle(): string { return this.awake ? 'idle_awake' : 'idle_asleep'; }

    /** OnFullMoon: wake or sleep, then settle on the idle pose. */
    onFullMoon(isfullmoon: boolean): void {
        if (this.inst.hasTag('burnt')) return;
        const { sprite } = this.inst;
        if (isfullmoon === this.awake) return;
        this.awake = isfullmoon;
        sprite.playOnce(isfullmoon ? 'wake' : 'sleep', () => sprite.playOnce(this.idle));
    }

    /** OnWorked: hit, then back to the current idle pose. */
    hit(): void {
        const { sprite } = this.inst;
        sprite.playOnce('hit', () => sprite.start(this.idle));
    }

    dispose(): void {
        this.cleanups.splice(0).forEach(stop => stop());
        this.fliesController?.dispose();
        this.inst.sprite.detachFx('flies');
        this.flies.instance.remove(); this.flies.display.dispose();
    }
}

function onworked(inst: PrefabInstance): void {
    if (!inst.hasTag('burnt')) (inst as StickHeadInstance).head.hit();
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    if ((inst as StickHeadInstance).head.isFullMoon) inst.components.lootdropper!.SpawnLootPrefab('nightmarefuel');
    inst.components.lootdropper!.DropLoot();
    inst.remove();
}

/** stickheads.lua create_common: both heads share work, burn, loot and full-moon behaviour; only art and recipe loot differ. */
export class StickHeadInstance extends PrefabInstance {
    readonly head: StickHead;

    constructor(id: StickHeadId, world: PrefabWorldContext, position: ReadonlyVector3, sprites: SpriteResources) {
        super(id, new SpriteState({ name: DECLARATIONS[id].idleAnimation ?? 'idle', billboard: true }));
        const { fire, scheduler } = world;
        if (!fire || !scheduler) throw new Error('A stick head needs the world\'s fire effects and scheduler');
        this.worldServices = world;
        // The head's tile key is taken where it stands.
        this.setPosition(position.x, 0, position.z);
        MakeBuildingPersist(this);
        const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
        this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsaveBurnt(inst, data); };
        this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onloadBurnt(inst, data); };
        this.addTag('structure');
        this.addTag('beaverchewable'); // for werebeaver
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(3);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);
        const head = this.head = new StickHead(this, world, sprites);
        this.onRemove(() => head.dispose());
        // MakeSmallBurnable(inst, nil, nil, true): SMALL_BURNTIME, fire level 2, small propagator, burnt structure.
        const burn = new BurnableBinding(this, {
            burnTime: 10, fxLevel: 2, propagator: 'small',
            onExtinguish: () => { PlaySound('dontstarve/common/fireOut', this.position); },
            onBurnt: () => { DefaultBurntStructureFn(this); burn.dispose(); },
        }, { fire, scheduler });
        this.onRemove(() => burn.dispose());
    }
}

/** The Prefab table stickheads.lua returns for the two heads; the placers are the build flow's. */
export function stickHeadPrefabs(world: PrefabWorldContext) {
    const define = (id: StickHeadId, bank: string) =>
        buildingPrefab(DECLARATIONS[id], bank, undefined, (position, sprites) => new StickHeadInstance(id, world, position, sprites), world);
    return { [PIG_HEAD_ID]: define(PIG_HEAD_ID, 'pig_head'), [MERM_HEAD_ID]: define(MERM_HEAD_ID, 'merm_head') };
}
