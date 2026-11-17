export type HatEquipMode = 'normal' | 'opentop' | 'fullhelm';

/** The archive/symbol fields art resolution needs; gameplay metadata stays in the prefab package. */
export interface HatArtDefinition {
  readonly archive: string;
  readonly equip: {
    readonly mode: HatEquipMode;
    readonly symbol: string;
    readonly activated?: { readonly archive: string };
    readonly follow?: {
      readonly animation: string;
      readonly symbols?: readonly string[];
      readonly extraBuilds?: readonly string[];
    };
  };
  readonly skinArchives: Readonly<Record<string, string>>;
  readonly skinEquipModes: Readonly<Record<string, HatEquipMode>>;
}
