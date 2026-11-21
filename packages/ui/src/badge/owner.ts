/** A stat component's delta event: health.lua / hunger.lua / sanity.lua DoDelta. */
export interface StatDeltaData {
  readonly oldpercent: number;
  readonly newpercent: number;
  readonly overtime?: boolean;
}

/** What StatusDisplays and its badges read from their owner: the player's tags, components and replicas. */
export interface BadgeOwner {
  hasTag(tag: string): boolean;
  ListenForEvent(
    event: 'healthdelta' | 'hungerdelta' | 'sanitydelta',
    fn: (inst: unknown, data: StatDeltaData) => void,
  ): () => void;
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly components: {
    readonly health?: {
      readonly maxhealth: number;
      readonly penalty: number;
      GetPercent(): number;
      IsHurt(): boolean;
    };
    readonly hunger?: { readonly max: number; GetPercent(): number; IsStarving(): boolean };
    readonly sanity?: {
      readonly max: number;
      GetPercent(): number;
      GetPercentWithPenalty(): number;
      GetPenaltyPercent(): number;
      GetSanityMode(): number;
      GetRateScale(): number;
      IsInsane(): boolean;
      IsEnlightened(): boolean;
    };
    readonly inventory?: { EquipHasTag(tag: string): boolean };
    /** sleepingbag.lua sets player_classified.issleephealing from its healthsleep while the bed holds a sleeper. */
    readonly sleepingbaguser?: { readonly bed?: { readonly healthsleep: boolean } };
  };
}
