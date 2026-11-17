import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSpriteDefinition, type ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { createStaticSpriteFactory, type StaticSpriteFactory, type StaticSpriteOptions } from '@dontstarve-web/animation/wallSprite';
import type { ArchiveSpriteSource } from './displayEngine';
import type { LoadedSpriteSource, SpriteSource } from './prefabDisplay';

type ArchiveDefinition = Omit<ArchiveSpriteDefinition, 'animation' | 'loop'>;
type ArchiveOptions = Omit<ArchiveSpriteOptions, 'foot' | 'name' | 'sharedAnimations'>;

export async function prewarmCachedBuilds(assets: ArchiveSpriteAssets, archives: readonly string[]): Promise<void> {
  await Promise.all(archives.map(archive => assets.loadBuild(archive)));
}

/** A manager's shared display resources. Declaring a source performs no IO; its display loads it on demand. */
export class SpriteResources {
  readonly archives: ArchiveSpriteAssets;
  private readonly archiveSources = new Map<string, ArchiveSpriteSource>();
  private readonly staticSources = new Map<string, LoadedSpriteSource>();
  private readonly staticFactories = new Set<StaticSpriteFactory>();
  private disposed = false;
  private readonly base: string;

  /** `archives` shares an existing archive owner, such as the ground items' with their equipment art; these resources then release it. */
  constructor(base = `${import.meta.env.BASE_URL}dst/data/anim`, materialName = 'sprite', archives = new ArchiveSpriteAssets(materialName, base)) {
    this.base = base;
    this.archives = archives;
  }

  archive(definition: ArchiveDefinition, options: ArchiveOptions = {}): ArchiveSpriteSource {
    const key = JSON.stringify([definition, options]);
    let source = this.archiveSources.get(key);
    if (!source) {
      let loaded: Awaited<ReturnType<typeof preloadSharedArchiveSprite>> | undefined;
      let pending: Promise<NonNullable<typeof loaded>> | undefined;
      source = { create: clip => {
        if (this.disposed) throw new Error('Sprite resources disposed');
        if (loaded) return loaded(clip.name, clip.loop);
        pending ??= preloadSharedArchiveSprite(this.archives, definition, options).then(create => loaded = create,
          error => { pending = undefined; throw error; });
        return pending.then(create => {
          if (this.disposed) throw new Error('Sprite resources disposed');
          return create(clip.name, clip.loop);
        });
      } };
      this.archiveSources.set(key, source);
    }
    return source;
  }

  /** Static build poses and their transient clips share one factory per compatible declaration. */
  staticFactory(buildArchive: string, options: StaticSpriteOptions): LoadedSpriteSource {
    const key = JSON.stringify([buildArchive, options]);
    let source = this.staticSources.get(key);
    if (!source) {
      let loaded: SpriteSource | undefined;
      let pending: Promise<SpriteSource> | undefined;
      source = { peek: () => loaded, load: () => {
        if (this.disposed) return Promise.reject(new Error('Sprite resources disposed'));
        return pending ??= createStaticSpriteFactory(this.base, buildArchive, options).then(factory => {
          if (this.disposed) { factory.dispose(); throw new Error('Sprite resources disposed'); }
          this.staticFactories.add(factory);
          return loaded = { create: () => factory.create(), release: sprite => factory.disposeSprite(sprite) };
        }).catch(error => { pending = undefined; throw error; });
      } };
      this.staticSources.set(key, source);
    }
    return source;
  }

  /** The owner first removes its entities, then releases their shared resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const factory of this.staticFactories) factory.dispose();
    this.archives.dispose();
    this.archiveSources.clear();
    this.staticFactories.clear(); this.staticSources.clear();
  }
}
