import type { PerishStage } from './perishable';

// tuning.lua
const STALE_FOOD_HUNGER = .667;
const SPOILED_FOOD_HUNGER = .5;
const STALE_FOOD_HEALTH = .333;
const SPOILED_FOOD_HEALTH = 0;
const SANITY_SMALL = 10;

/** components/edible.lua value getters for an eater without eater-specific spoilage rules. */
export class Edible {
  healthvalue = 10;
  hungervalue = 10;
  sanityvalue = 0;
  degrades_with_spoilage = true;
  stale_hunger = STALE_FOOD_HUNGER;
  stale_health = STALE_FOOD_HEALTH;
  spoiled_hunger = SPOILED_FOOD_HUNGER;
  spoiled_health = SPOILED_FOOD_HEALTH;
  private readonly perishStage: () => PerishStage | undefined;

  /** The stage reads the inst's perishable component at eating time, if it has one. */
  constructor(perishStage: () => PerishStage | undefined = () => undefined) {
    this.perishStage = perishStage;
  }

  GetSanity(): number {
    const sanityvalue = this.sanityvalue;
    if (this.degrades_with_spoilage && sanityvalue >= 0) {
      const stage = this.perishStage();
      if (stage === 'stale') { if (sanityvalue > 0) return 0; }
      else if (stage === 'spoiled') return -SANITY_SMALL;
    }
    return sanityvalue;
  }

  GetHunger(): number {
    return this.hungervalue * this.spoilageMultiplier(this.hungervalue, this.stale_hunger, this.spoiled_hunger);
  }

  GetHealth(): number {
    return this.healthvalue * this.spoilageMultiplier(this.healthvalue, this.stale_health, this.spoiled_health);
  }

  private spoilageMultiplier(value: number, stale: number, spoiled: number): number {
    // Negative values ignore spoilage.
    if (!this.degrades_with_spoilage || value < 0) return 1;
    const stage = this.perishStage();
    return stage === 'stale' ? stale : stage === 'spoiled' ? spoiled : 1;
  }
}
