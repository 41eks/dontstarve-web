import * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { sculptingtable_init_fn } from '@dontstarve-web/animation/prefabskin';
import { createRenderEffect, createSignal, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import { loadSymbolOverride, type LoadedSymbolOverride, type SpriteController } from '@dontstarve-web/animation/sprite';
import {
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
    type AnimatedBuildingPreparedResources,
} from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { Pickable } from './components/pickable';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import type { PlacementSaveRecord } from './saveRecord';

export const SCULPTING_TABLE_ID = 'sculptingtable' as const;
export type SculptingTableId = typeof SCULPTING_TABLE_ID;
export const SCULPTING_TABLE_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.sculptingtable.skinArchives;

/** sculptingtable.lua sculptable_materials: swapfile/symbol replace the table's block symbol. */
export const SCULPTABLE_MATERIALS = {
    marble: { swapfile: 'marble', symbol: 'marble01' },
    cutstone: { swapfile: 'cutstone', symbol: 'cutstone01' },
} as const;
export type SculptableMaterial = keyof typeof SCULPTABLE_MATERIALS;

export function isSculptableMaterial(itemId: string): itemId is SculptableMaterial {
    return Object.hasOwn(SCULPTABLE_MATERIALS, itemId);
}

export type SculptingTableSaveState = NonNullable<PlacementSaveRecord['components']['sculptingtable']>;

// pickable:SetUp(itemname, 1000000) then Pause(): the held item never regrows.
const HELD_ITEM_REGEN_TIME = 1000000;
const SCULPTING_SYMBOL = 'cutstone01';
const PLACE_SOUND = 'dontstarve/common/together/sculpting_table/craft';
const ITEM_SOUND = 'dontstarve/common/together/moonbase/moonstaff_place';

interface SculptingResources extends AnimatedBuildingPreparedResources {
    readonly overrides: Readonly<Record<SculptableMaterial, LoadedSymbolOverride>>;
}

interface SculptingState {
    readonly pickable: Pickable;
    readonly trader: Trader<TradeItem>;
    readonly sounds: Set<SoundHandle>;
    readonly resources: Signal<SculptingResources | undefined>;
    readonly stopHeldItem: () => void;
}

const stateOf = (model: THREE.Object3D): SculptingState => model.userData.sculptingtable;

function playTableSound(model: THREE.Group, path: SoundEventPath): void {
    const { sounds } = stateOf(model);
    for (const sound of sounds) if (!sound.isPlaying()) sounds.delete(sound);
    sounds.add(PlaySound(path, model.position));
}

async function prepare(): Promise<SculptingResources> {
    const base = `${import.meta.env.BASE_URL}dst/data/anim`;
    const [overrides] = await Promise.all([
        Promise.all(Object.values(SCULPTABLE_MATERIALS).map(({ swapfile, symbol }) =>
            loadSymbolOverride(base, `${swapfile}.zip`, symbol))),
        PreloadSounds(PLACE_SOUND, ITEM_SOUND),
    ]);
    const ids = Object.keys(SCULPTABLE_MATERIALS) as SculptableMaterial[];
    return {
        materials: overrides.flatMap(override => override.materials),
        overrides: Object.fromEntries(ids.map((id, index) => [id, overrides[index]])) as SculptingResources['overrides'],
    };
}

/** OverrideSymbol/ClearOverrideSymbol for the held block, redone for every rebuilt sprite and reskin. */
function showHeldItem(model: THREE.Group, pickable: Pickable, resources: Signal<SculptingResources | undefined>, art?: ReadonlySignal<number>): () => void {
    return createRenderEffect(() => {
        art?.get();
        const sprite = model.userData.animationController as SpriteController;
        const loaded = resources.get(), held = pickable.state.canInteractWith.get();
        const itemname = held ? pickable.product : undefined;
        sprite.overrideSymbol(SCULPTING_SYMBOL, itemname !== undefined && isSculptableMaterial(itemname) && loaded ? loaded.overrides[itemname] : undefined);
    });
}

/** giveitem: the block becomes pickable and shows the offered material. */
function giveItem(model: THREE.Group, itemname: SculptableMaterial): void {
    const { pickable } = stateOf(model);
    pickable.SetUp(itemname, HELD_ITEM_REGEN_TIME);
    pickable.pause();
    if (!pickable.canInteractWith) {
        pickable.canInteractWith = true;
        playTableSound(model, ITEM_SOUND);
    }
}

function onbuilt({ animation, model, onComplete }: AnimatedBuildingBuiltContext): void {
    playTableSound(model, PLACE_SOUND);
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

function oninit({ model, prepared, art }: AnimatedBuildingEventContext): void {
    const entity = actionEntity(model, SCULPTING_TABLE_ID);
    entity.addTag('structure');
    // onitemtaken: the pickable stops being interactable and the block disappears.
    const pickable = new Pickable(model, '', HELD_ITEM_REGEN_TIME, 1, () => {
        if (pickable.canInteractWith) {
            pickable.canInteractWith = false;
            playTableSound(model, ITEM_SOUND);
        }
    });
    pickable.canInteractWith = false;
    pickable.pause();
    const trader = new Trader<TradeItem>(entity);
    trader.acceptsNonTradable = true;
    trader.SetAbleToAcceptTest(item => {
        if (pickable.canInteractWith) return { ok: false, reason: 'SLOTFULL' };
        return isSculptableMaterial(item.prefab) ? { ok: true } : { ok: false, reason: 'NOTSCULPTABLE' };
    });
    trader.SetOnAccept((_giver, item) => {
        if (isSculptableMaterial(item.prefab)) giveItem(model, item.prefab);
    });
    model.userData.components.trader = trader;
    const resources = createSignal(prepared as SculptingResources | undefined);
    model.userData.sculptingtable = { pickable, trader, sounds: new Set(), resources,
        stopHeldItem: showHeldItem(model, pickable, resources, art) } satisfies SculptingState;
}

export const SCULPTING_TABLE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.sculptingtable,
    obstacleRadius: 0.4,
    hammerWorkLeft: 4, hammerMaterial: 'wood',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    // dropitems: the held block comes out with the recipe loot.
    hammerHeldLoot: ({ model }) => {
        const { pickable } = stateOf(model);
        return pickable.canInteractWith && pickable.product ? [{ itemId: pickable.product, count: 1 }] : [];
    },
    skinInit: sculptingtable_init_fn,
    prepare,
    onbuilt,
    oninit,
    // The replacement sprite brings its own loaded builds and a fresh controller.
    onreskin: ({ model, prepared }) => stateOf(model).resources.set(prepared as SculptingResources | undefined),
    ondispose: ({ model }) => {
        const { pickable, trader, sounds, stopHeldItem } = stateOf(model);
        stopHeldItem();
        for (const sound of sounds) sound.stop();
        sounds.clear();
        pickable.dispose();
        trader.dispose();
    },
    // onload: giveitem restores the held block.
    onrestore: ({ model }, components) => {
        const itemname = components.sculptingtable?.itemname;
        if (itemname !== undefined && isSculptableMaterial(itemname)) giveItem(model, itemname);
    },
    // onsave: data.itemname = caninteractwith and product or nil.
    exportComponents: ({ model }) => {
        const { pickable } = stateOf(model);
        return pickable.canInteractWith && pickable.product ? { sculptingtable: { itemname: pickable.product } } : {};
    },
};
