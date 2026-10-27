import { loadAnimationArchive } from './animationAssets';
import { createSpriteFactory, type AnimatedSpriteFactory } from './sprite';

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

/**
 * The sprite sources of entities a worn hat spawns (alterguardian_hat_equipped), one factory per archive and per player.
 * Displays load them when such an entity is drawn; the worn hat itself only names builds on the owner's AnimState.
 */
export class HatArtAssets {
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly loaded = new Map<string, AnimatedSpriteFactory>();
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(assetBaseUrl: string) { this.assetBaseUrl = assetBaseUrl; }

  /** The owner removes the spawned entities on unequip, before the factories go. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const factory of this.factories.values()) void factory.then(factory => factory.dispose(), () => undefined);
    this.factories.clear();
    this.loaded.clear();
  }

  peekFactory(archive: string): AnimatedSpriteFactory | undefined { return this.loaded.get(archive); }

  loadFactory(archive: string): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Hat assets have been disposed'));
    let request = this.factories.get(archive);
    if (!request) {
      request = loadAnimationArchive(archive, this.assetBaseUrl).then(({ buildPackage, animations }) => {
        if (this.disposed) throw new Error('Hat assets have been disposed');
        const factory = createSpriteFactory(buildPackage, animations);
        for (const material of factory.build.materials) material.name = `hat:${buildPackage.build.name}`;
        this.loaded.set(archive, factory);
        return factory;
      });
      this.factories.set(archive, request);
      void request.catch(() => this.factories.delete(archive));
    }
    return request;
  }
}
