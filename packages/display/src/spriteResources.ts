import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSpriteDefinition, type ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { loadAnim, loadBuild, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import { createSpriteFactory, SpriteController, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { ArchiveSpriteSource } from './displayEngine';
import type { LoadedSpriteSource, SpriteSource } from './prefabDisplay';

type ArchiveDefinition = Omit<ArchiveSpriteDefinition, 'animation' | 'loop'>;
type ArchiveOptions = Omit<ArchiveSpriteOptions, 'foot' | 'name' | 'sharedAnimations'>;
interface FactoryDefinition { animationArchive: string; extraAnimationArchives?: readonly string[]; buildArchive: string; skinArchive?: string }

/** A manager's shared display resources. Declaring a source performs no IO; its display loads it on demand. */
export class SpriteResources {
  readonly archives: ArchiveSpriteAssets;
  private readonly archiveSources = new Map<string, ArchiveSpriteSource>();
  private readonly factorySources = new Map<typeof SpriteController, Map<string, LoadedSpriteSource>>();
  private readonly factories = new Set<AnimatedSpriteFactory>();
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
          loadBuild(definition.buildArchive, this.base),
          Promise.all([definition.animationArchive, ...definition.extraAnimationArchives ?? []].map(file => loadAnim(file, this.base))),
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

  /** The owner first removes its entities, then releases their shared resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.archives.dispose();
    for (const factory of this.factories) factory.dispose();
    this.factories.clear(); this.archiveSources.clear(); this.factorySources.clear();
  }
}
