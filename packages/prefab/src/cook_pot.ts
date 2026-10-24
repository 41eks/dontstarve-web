import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import type { AnimatedBuildingEventContext } from './animatedBuildingPlacement';
import type * as THREE from 'three';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

import { Stewer, type StewerSaveData } from '../../componets/src/stewer';
import { BASE_COOK_TIME, GetRecipe, recipes } from '../../componets/src/cooking';
import { createMaterials, loadBuild, smallHash, type BuildPackage } from '../../animation/src/animationAssets';
import { SpriteController } from '../../animation/src/sprite';
import { createBuildingContainer } from './containers';

export const BEEFALO_FEED_COOK_TIME = BASE_COOK_TIME * GetRecipe('cookpot', 'beefalofeed')!.cooktime;
export interface CookPotSaveState {
    product: string;
    phase: 'cooking' | 'done';
    remainingSeconds: number;
    ingredient_prefabs?: readonly string[];
    chef_id?: string;
}

const foodBuilds = new Map<string, BuildPackage>();
async function prepareFoodBuilds(): Promise<void> {
    const builds = new Set(Object.values(recipes.cookpot).map(recipe => recipe.overridebuild ?? 'cook_pot_food'));
    await Promise.all([...builds].map(async build => {
        foodBuilds.set(build, await loadBuild(`${build}.zip`, `${import.meta.env.BASE_URL}dst/data/anim`));
    }));
}

function initializeFoodArt(model: THREE.Group): void {
    model.userData.cookFoodMaterials = new Map();
}

/** cookpot.lua:SetProductSymbol uses each recipe's build, symbol and potlevel. */
function showProduct(model: THREE.Group): void {
    const stewer = model.userData.components.stewer as Stewer;
    if (!stewer.product) return;
    const recipe = stewer.GetRecipeForProduct();
    const buildName = recipe?.overridebuild ?? 'cook_pot_food';
    const build = foodBuilds.get(buildName)!;
    let materials = model.userData.cookFoodMaterials.get(buildName);
    if (!materials) {
        materials = createMaterials(build);
        model.userData.cookFoodMaterials.set(buildName, materials);
        model.userData.ownedSpriteMaterials.push(...materials);
    }
    const level = recipe?.potlevel ?? 'mid';
    (model.userData.animationController as SpriteController).setSymbolOverrides(new Map([
        [smallHash('swap_cooked'), { build: build.build, materials, symbolHash: smallHash(recipe?.overridesymbolname ?? stewer.product) }],
    ]), ['high', 'mid', 'low'].filter(candidate => candidate !== level).map(candidate => `swap_${candidate}`));
}

export function cookPotState(model: THREE.Group): CookPotSaveState | undefined {
    const stewer = model.userData.components?.stewer as Stewer | undefined;
    if (!stewer?.product) return undefined;
    const saved = stewer.OnSave();
    return {
        product: stewer.product, phase: stewer.IsDone() ? 'done' : 'cooking', remainingSeconds: stewer.GetTimeToCook(),
        ...(saved.ingredient_prefabs === undefined ? {} : { ingredient_prefabs: saved.ingredient_prefabs }),
        ...(saved.chef_id === undefined ? {} : { chef_id: saved.chef_id }),
    };
}

function continueCooking(model: THREE.Group): void {
    model.userData.animationController.start('cooking_loop');
    (model.userData.stewerSound as SoundHandle | undefined)?.stop();
    model.userData.stewerSound = PlaySound('dontstarve/common/cookingpot_rattle', model.position);
}

function initializePot({ model }: AnimatedBuildingEventContext): void {
    initializeFoodArt(model);
    const tags: string[] = [];
    model.userData.tags = tags;
    const components = model.userData.components;
    const stewer = new Stewer({ prefab: 'cookpot', components,
        getPosition: () => model.userData.getGroundPosition(),
        addTag: tag => { if (!tags.includes(tag)) tags.push(tag); },
        removeTag: tag => {
            const index = tags.indexOf(tag);
            if (index >= 0) tags.splice(index, 1);
        } }, (prefab, count = 1) => model.userData.dropLoot([{ itemId: prefab, count }]));
    components.stewer = stewer;
    stewer.onstartcooking = () => continueCooking(model);
    stewer.oncontinuecooking = () => continueCooking(model);
    stewer.ondonecooking = () => {
        showProduct(model);
        (model.userData.stewerSound as SoundHandle | undefined)?.stop();
        delete model.userData.stewerSound;
        PlaySound('dontstarve/common/cookingpot_finish', model.position);
        model.userData.animationController.playOnce('cooking_pst', () => model.userData.animationController.start('idle_full'));
    };
    stewer.oncontinuedone = () => { showProduct(model); model.userData.animationController.start('idle_full'); };
    stewer.onharvest = () => {
        model.userData.animationController.start('idle_empty');
        PlaySound('dontstarve/common/cookingpot_close', model.position);
    };
    // Compatibility projection only; the component is the sole authoritative state.
    Object.defineProperty(model.userData, 'stewer', { configurable: true, get: () => cookPotState(model) });
}

/** DST uses cookpot as the prefab ID and cook_pot as its animation bank/build. */
export const COOK_POT_ID = 'cookpot' as const;
export type CookPotId = typeof COOK_POT_ID;

export const COOK_POT_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.cookpot.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle_empty');
        onComplete();
    });
}

export const COOK_POT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.cookpot,
    hammerWorkLeft: 4, hammerMaterial: 'metal',
    burnable: { burnTime: 20, fxLevel: 3, propagator: 'small' },
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    interaction: { ...definitions.animatedBuildings.cookpot.interaction, closeImmediately: true },
    onbuilt,
    prepare: async () => { await Promise.all([prepareFoodBuilds(), PreloadSounds('dontstarve/common/cookingpot_rattle', 'dontstarve/common/cookingpot_close', 'dontstarve/common/cookingpot_finish')]); },
    oninit: initializePot,
    onhit: ({ model, animation }) => {
        const stewer = model.userData.components.stewer as Stewer;
        if (stewer.IsCooking()) {
            animation.playOnce('hit_cooking', () => animation.start('cooking_loop'));
            PlaySound('dontstarve/common/cookingpot_close', model.position);
        } else if (stewer.IsDone()) animation.playOnce('hit_full', () => animation.start('idle_full'));
        else {
            const container = model.userData.components.container;
            if (container.IsOpen()) container.Close();
            else PlaySound('dontstarve/common/cookingpot_close', model.position);
            animation.playOnce('hit_empty', () => animation.start('idle_empty'));
        }
    },
    onhammered: ({ model, position, dropLoot, spawnEffect, remove }) => {
        const stewer = model.userData.components.stewer as Stewer;
        if (stewer.IsDone()) stewer.Harvest({ giveItem: (itemId, count) => { dropLoot([{ itemId, count }]); return true; } });
        model.userData.components.container.DropEverything(position);
        dropLoot([{ itemId: 'cutstone', count: 2 }, { itemId: 'charcoal', count: 3 }, { itemId: 'twigs', count: 3 }]);
        spawnEffect();
        PlaySound('dontstarve/common/destroy_smoke', position); PlaySound('dontstarve/common/destroy_metal', position);
        remove();
    },
    createContainer: inst => createBuildingContainer('cookpot', inst),
    canInteract: ({ model }) => model.userData.components?.container?.canbeopened !== false,
    onclose: ({ model, animation }) => {
        if (!(model.userData.components.stewer as Stewer).IsCooking()) animation.start('idle_empty');
        PlaySound('dontstarve/common/cookingpot_close', model.position);
    },
    onrestore: ({ model }, components) => {
        const state = components.stewer;
        if (state) (model.userData.components.stewer as Stewer).OnLoad({
            product: state.product, done: state.phase === 'done',
            ...(state.phase === 'cooking' ? { remainingtime: state.remainingSeconds } : {}),
            ingredient_prefabs: state.ingredient_prefabs, chef_id: state.chef_id,
        } satisfies StewerSaveData);
    },
    onreskin: ({ model }) => {
        initializeFoodArt(model);
        const stewer = model.userData.components.stewer as Stewer;
        if (!stewer) return;
        if (stewer.IsCooking()) model.userData.animationController.start('cooking_loop');
        else if (stewer.IsDone()) { showProduct(model); model.userData.animationController.start('idle_full'); }
    },
    exportComponents: ({ model }) => {
        const state = cookPotState(model);
        return state ? { stewer: state } : {};
    },
    onupdate: ({ model }, dt) => (model.userData.components.stewer as Stewer | undefined)?.LongUpdate(dt),
    ondispose: ({ model }) => {
        (model.userData.stewerSound as SoundHandle | undefined)?.stop();
        (model.userData.components.stewer as Stewer | undefined)?.OnRemoveFromEntity();
    },
};

const COOK_POT_DEFINITIONS: Readonly<Record<CookPotId, AnimatedBuildingDefinition>> = {
    [COOK_POT_ID]: COOK_POT_DEFINITION,
};

export class CookPotPlacement extends AnimatedBuildingPlacement<CookPotId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: CookPotId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<CookPotId>) => void,
    ) {
        super(world, COOK_POT_DEFINITIONS, consumeBufferedBuild, onInteractionChange);
    }
}
