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

// tuning.lua: night_time = 30 * 2; BASE_COOK_TIME = night_time * .3333.
// preparedfoods.lua: beefalofeed.cooktime = .5, overridebuild = cook_pot_food11.
export const BEEFALO_FEED_COOK_TIME = 30 * 2 * .3333 * .5;
export interface CookPotSaveState {
    product: 'beefalofeed';
    phase: 'cooking' | 'done';
    remainingSeconds: number;
}

export function cookPotState(model: THREE.Group): CookPotSaveState | undefined {
    return model.userData.stewer;
}

export function startCookPotCooking({ model, animation }: AnimatedBuildingEventContext, consume: () => boolean,
    cookTime = BEEFALO_FEED_COOK_TIME): boolean {
    if (cookPotState(model) || !consume()) return false;
    model.userData.stewer = { product: 'beefalofeed', phase: 'cooking', remainingSeconds: cookTime } satisfies CookPotSaveState;
    animation.start('cooking_loop');
    PlaySound('dontstarve/common/cookingpot_close', model.position);
    model.userData.stewerSound = PlaySound('dontstarve/common/cookingpot_rattle', model.position);
    return true;
}

function restoreCookingAnimation({ model, animation }: AnimatedBuildingEventContext): void {
    const state = cookPotState(model);
    if (state) animation.start(state.phase === 'cooking' ? 'cooking_loop' : 'idle_full');
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
    onbuilt,
    prepare: () => PreloadSounds('dontstarve/common/cookingpot_rattle', 'dontstarve/common/cookingpot_close', 'dontstarve/common/cookingpot_finish'),
    symbolOverrides: { swap_cooked: { archive: 'cook_pot_food11.zip', symbol: 'beefalofeed' } },
    // cookpot.lua SetProductSymbol: default potlevel shows swap_mid only.
    hiddenLayers: ['swap_high', 'swap_low'],
    canInteract: ({ model }) => cookPotState(model) === undefined,
    onrestore: (context, components) => {
        if (components.stewer) context.model.userData.stewer = { ...components.stewer };
        restoreCookingAnimation(context);
        if (components.stewer?.phase === 'cooking') {
            context.model.userData.stewerSound = PlaySound('dontstarve/common/cookingpot_rattle', context.model.position);
        }
    },
    onreskin: restoreCookingAnimation,
    exportComponents: ({ model }) => {
        const state = cookPotState(model);
        return state ? { stewer: { ...state } } : {};
    },
    onupdate: ({ model, animation }, dt) => {
        const state = cookPotState(model);
        if (!state || state.phase !== 'cooking') return;
        state.remainingSeconds = Math.max(0, state.remainingSeconds - Math.max(0, dt));
        if (state.remainingSeconds > 0) return;
        state.phase = 'done';
        (model.userData.stewerSound as SoundHandle | undefined)?.stop();
        delete model.userData.stewerSound;
        PlaySound('dontstarve/common/cookingpot_finish', model.position);
        animation.playOnce('cooking_pst', () => animation.start('idle_full'));
    },
    ondispose: ({ model }) => (model.userData.stewerSound as SoundHandle | undefined)?.stop(),
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
