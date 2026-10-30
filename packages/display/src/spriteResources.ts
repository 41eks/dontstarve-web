import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSpriteDefinition, type ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import { createAnimatedSpriteSource, createSpriteFactory, SpriteController, type AnimatedSpriteFactory, type AnimatedSpriteOptions,
  type AnimatedSpriteSourceOptions } from '@dontstarve-web/animation/sprite';
import { createStaticSpriteFactory, type StaticSpriteFactory, type StaticSpriteOptions } from '@dontstarve-web/animation/wallSprite';
import type { ArchiveSpriteSource } from './displayEngine';
import type { LoadedSpriteSource, SpriteSource } from './prefabDisplay';

type ArchiveDefinition = Omit<ArchiveSpriteDefinition, 'animation' | 'loop'>;
type ArchiveOptions = Omit<ArchiveSpriteOptions, 'foot' | 'name' | 'sharedAnimations'>;
/** Per-entity options of an animated source's sprites; the clip and its first frame come from the display. */
export type AnimatedSpriteDeclaration = Omit<AnimatedSpriteOptions, 'initialAnimation' | 'initialFrame' | 'getWatchWorldContent' | 'snowCovered'>;
interface FactoryDefinition { animationArchive: string; extraAnimationArchives?: readonly string[]; buildArchive: string; skinArchive?: string }

export async function prewarmCachedBuilds(assets: ArchiveSpriteAssets, archives: readonly string[]): Promise<void> {
  await Promise.all(archives.map(archive => assets.loadBuild(archive)));
}

/** A manager's shared display resources. Declaring a source performs no IO; its display loads it on demand. */
export class SpriteResources {
  readonly archives: ArchiveSpriteAssets;
  private readonly archiveSources = new Map<string, ArchiveSpriteSource>();
  private readonly factorySources = new Map<typeof SpriteController, Map<string, LoadedSpriteSource>>();
  private readonly factories = new Set<AnimatedSpriteFactory>();
  private readonly animatedFactories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly animatedSources = new Map<string, LoadedSpriteSource>();
  private readonly staticSources = new Map<string, LoadedSpriteSource>();
  private readonly staticFactories = new Set<StaticSpriteFactory>();
  private disposed = false;
  private readonly base: string;

  constructor(base = `${import.meta.env.BASE_URL}dst/data/anim`, materialName = 'sprite') {
    this.base = base;
    this.archives = new ArchiveSpriteAssets(materialName, base);
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

  factory(definition: FactoryDefinition, controller = SpriteController): LoadedSpriteSource {
    const key = JSON.stringify(definition);
    let sources = this.factorySources.get(controller);
    if (!sources) this.factorySources.set(controller, sources = new Map());
    let source = sources.get(key);
    if (!source) {
      let loaded: SpriteSource | undefined;
      let pending: Promise<SpriteSource> | undefined;
      source = { peek: () => loaded, load: () => {
        if (this.disposed) return Promise.reject(new Error('Sprite resources disposed'));
        return pending ??= Promise.all([
          this.archives.loadBuild(definition.buildArchive),
          Promise.all([definition.animationArchive, ...definition.extraAnimationArchives ?? []].map(file => this.archives.loadAnimation(file))),
          definition.skinArchive ? loadSpriteSkinArchive(definition.skinArchive, this.base) : undefined,
        ]).then(([build, animations, skin]) => {
          const factory = createSpriteFactory(build, { animations: animations.flatMap(bank => bank.animations) }, controller, skin);
          if (this.disposed) { factory.dispose(); throw new Error('Sprite resources disposed'); }
          this.factories.add(factory);
          return loaded = { create: (animation, frame) => factory.create({ initialAnimation: animation, initialFrame: frame }),
            release: sprite => factory.disposeSprite(sprite) };
        }).catch(error => { pending = undefined; throw error; });
      } };
      sources.set(key, source);
    }
    return source;
  }

  /**
   * `createAnimatedSpriteSource` art: one bank, build, skin and symbol overrides shared by every declaration of the same
   * archive and source options; `sprite` holds each declaration's own options, such as scale and hidden layers.
   */
  animated(archive: string, source: AnimatedSpriteSourceOptions = {}, sprite: AnimatedSpriteDeclaration = {}): LoadedSpriteSource {
    const factoryKey = JSON.stringify([archive, source]), key = JSON.stringify([factoryKey, sprite]);
    let declared = this.animatedSources.get(key);
    if (!declared) {
      let loaded: SpriteSource | undefined;
      declared = { peek: () => loaded, load: () => {
        if (this.disposed) return Promise.reject(new Error('Sprite resources disposed'));
        let request = this.animatedFactories.get(factoryKey);
        if (!request) {
          request = createAnimatedSpriteSource(this.base, archive, source).then(factory => {
            if (this.disposed) { factory.dispose(); throw new Error('Sprite resources disposed'); }
            this.factories.add(factory);
            return factory;
          });
          this.animatedFactories.set(factoryKey, request);
          void request.catch(() => this.animatedFactories.delete(factoryKey));
        }
        return request.then(factory => loaded = { create: (animation, frame) => factory.create({ ...sprite, initialAnimation: animation, initialFrame: frame }),
          release: drawn => factory.disposeSprite(drawn) });
      } };
      this.animatedSources.set(key, declared);
    }
    return declared;
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
    for (const factory of this.factories) factory.dispose();
    for (const factory of this.staticFactories) factory.dispose();
    this.archives.dispose();
    this.factories.clear(); this.archiveSources.clear(); this.factorySources.clear();
    this.staticFactories.clear(); this.staticSources.clear(); this.animatedFactories.clear(); this.animatedSources.clear();
  }
}
