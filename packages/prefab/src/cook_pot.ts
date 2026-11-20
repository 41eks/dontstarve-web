import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, SaveBuilding } from './building';
import type * as THREE from 'three';
import { PrefabInstance, prefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import { Stewer } from '../../componets/src/stewer';
import { BASE_COOK_TIME, GetRecipe } from '../../componets/src/cooking';
import type { EntityPersistData } from './saveRecord';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const BEEFALO_FEED_COOK_TIME = BASE_COOK_TIME * GetRecipe('cookpot', 'beefalofeed')!.cooktime;

/** DST uses cookpot as the prefab ID and cook_pot as its animation bank/build. */
export const COOK_POT_ID = 'cookpot' as const;
export type CookPotId = typeof COOK_POT_ID;

const declaration = definitions.animatedBuildings.cookpot;

export const COOK_POT_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives;

/** cookpot.lua MakePlacer("cookpot_placer", "cook_pot", "cook_pot", "idle_empty"). */
export const COOK_POT_PLACER = buildingPlacer(declaration, 'cook_pot');

/** What the stewer holds, for views and tests: the phase it is in and the seconds left to cook. */
export interface CookPotState {
    product: string;
    phase: 'cooking' | 'done';
    remainingSeconds: number;
}

export function cookPotState(model: THREE.Object3D): CookPotState | undefined {
    const stewer = prefabInstance(model)?.components.stewer;
    if (!stewer?.product) { return undefined; }
    return { product: stewer.product, phase: stewer.IsDone() ? 'done' : 'cooking', remainingSeconds: stewer.GetTimeToCook() };
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) { inst.components.burnable.Extinguish(); }
    const stewer = inst.components.stewer;
    if (!inst.hasTag('burnt') && stewer?.product !== undefined && stewer.IsDone()) { stewer.Harvest(); }
    inst.components.container?.DropEverything(inst.position);
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'metal');
    inst.remove();
}

function onhit(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    const stewer = inst.components.stewer!;
    if (stewer.IsCooking()) {
        inst.AnimState.PlayAnimation('hit_cooking');
        inst.AnimState.PushAnimation('cooking_loop', true);
        PlaySound('dontstarve/common/cookingpot_close', inst.position);
    } else if (stewer.IsDone()) {
        inst.AnimState.PlayAnimation('hit_full');
        inst.AnimState.PushAnimation('idle_full', false);
    } else {
        const container = inst.components.container;
        if (container?.IsOpen()) { container.Close(); }
        else { PlaySound('dontstarve/common/cookingpot_close', inst.position); }
        inst.AnimState.PlayAnimation('hit_empty');
        inst.AnimState.PushAnimation('idle_empty', false);
    }
}

/** startcookfn; the pot's Light is not ported. */
function startcookfn(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('cooking_loop', true);
    inst.SoundEmitter!.KillSound('snd');
    inst.SoundEmitter!.PlaySound('dontstarve/common/cookingpot_rattle', 'snd');
}

/** onopen; cookingpot_open and the "snd" cookingpot loop have no sound mapping yet. */
function onopen(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('cooking_pre_loop');
    inst.SoundEmitter!.KillSound('snd');
}

function onclose(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    if (!inst.components.stewer!.IsCooking()) {
        inst.AnimState.PlayAnimation('idle_empty');
        inst.SoundEmitter!.KillSound('snd');
    }
    PlaySound('dontstarve/common/cookingpot_close', inst.position);
}

function SetProductSymbol(inst: PrefabInstance, product: string): void {
    const recipe = GetRecipe(inst.prefab, product);
    const potlevel = recipe?.potlevel;
    const build = recipe?.overridebuild ?? 'cook_pot_food';
    const overridesymbol = recipe?.overridesymbolname ?? product;
    const level = potlevel === 'high' || potlevel === 'low' ? potlevel : 'mid';
    for (const candidate of ['high', 'mid', 'low']) {
        if (candidate === level) { inst.AnimState.Show(`swap_${candidate}`); } else { inst.AnimState.Hide(`swap_${candidate}`); }
    }
    inst.AnimState.OverrideSymbol('swap_cooked', build, overridesymbol);
}

function ShowProduct(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    const product = inst.components.stewer!.product;
    if (product !== undefined) { SetProductSymbol(inst, product); }
}

function donecookfn(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('cooking_pst');
    inst.AnimState.PushAnimation('idle_full', false);
    ShowProduct(inst);
    inst.SoundEmitter!.KillSound('snd');
    PlaySound('dontstarve/common/cookingpot_finish', inst.position);
}

function continuedonefn(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('idle_full');
    ShowProduct(inst);
}

function continuecookfn(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('cooking_loop', true);
    inst.SoundEmitter!.KillSound('snd');
    inst.SoundEmitter!.PlaySound('dontstarve/common/cookingpot_rattle', 'snd');
}

function harvestfn(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) { return; }
    inst.AnimState.PlayAnimation('idle_empty');
    PlaySound('dontstarve/common/cookingpot_close', inst.position);
}

/** onbuilt; cook_pot_craft has no sound mapping yet. */
function onbuilt(inst: PrefabInstance): void {
    inst.AnimState.PlayAnimation('place');
    inst.AnimState.PushAnimation('idle_empty', false);
}

/** onsave/onload, with the skin the building save shape keeps beside data.burnt. */
function onsave(inst: PrefabInstance, data: EntityPersistData): void {
    SaveBuilding(inst, data);
    onsaveBurnt(inst, data);
}

function onload(inst: PrefabInstance, data: EntityPersistData): void {
    onloadBurnt(inst, data);
}

/**
 * cookpot.lua MakeCookPot("cookpot", cookpot_common, cookpot_common_master), as far as it is ported: no Light, spoiling,
 * inspectable status, hauntable, snow cover or OnLoadPostPass additems.
 */
function fn(world: PrefabWorldContext, sprites: SpriteResources): PrefabInstance {
    const { fire, scheduler } = world;
    if (!fire || !scheduler) { throw new Error('A cookpot needs the world\'s fire effects and scheduler'); }
    const inst = new PrefabInstance(COOK_POT_ID, new SpriteState({ name: 'idle_empty', held: true, billboard: true }));
    inst.worldServices = world;
    inst.AddSoundEmitter();
    // inst.AnimState: the display dresses every drawn sprite and reskin with the product symbol and pot level.
    inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
    inst.addTag('structure');

    inst.OnSave = onsave;
    inst.OnLoad = onload;
    // The stewer reads its container as it is added, so the container comes first here.
    const container = MakeBuildingContainer(inst, COOK_POT_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;

    const stewer = addComponent(inst, 'stewer', Stewer, scheduler,
        (prefab, count = 1) => world.dropLoot?.([{ itemId: prefab, count }], inst.position));
    stewer.onstartcooking = startcookfn;
    stewer.oncontinuecooking = continuecookfn;
    stewer.oncontinuedone = continuedonefn;
    stewer.ondonecooking = donecookfn;
    stewer.onharvest = harvestfn;

    addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnFinishCallback(onhammered);
    workable.SetOnWorkCallback(onhit);

    inst.ListenForEvent('onbuilt', () => onbuilt(inst));

    // MakeMediumBurnable(inst, nil, nil, true) and MakeSmallPropagator.
    const burn = new BurnableBinding(inst, {
        burnTime: 20, fxLevel: 3, propagator: 'small',
        onExtinguish: () => { PlaySound('dontstarve/common/fireOut', inst.position); },
        onBurnt: () => { DefaultBurntStructureFn(inst); burn.dispose(); },
    }, { fire, scheduler });
    inst.onRemove(() => burn.dispose());
    return inst;
}

export function cookPotPrefabs(world: PrefabWorldContext) {
    return { [COOK_POT_ID]: { ...buildingPrefab(declaration, 'cook_pot', .5, (_position, sprites) => fn(world, sprites), world),
        // cookpot_common: MiniMapEntity:SetIcon("cookpot.png").
        minimapIcon: 'cookpot.png' } };
}
