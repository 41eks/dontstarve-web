import {
  ArchiveSpriteAssets,
  preloadSharedArchiveFrames,
  preloadSharedArchiveSprite,
  type SharedArchiveFrames,
  type ArchiveSpriteDefinition,
  type ArchiveSpriteOptions,
} from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteSource } from './displayEngine';

type ArchiveDefinition = Omit<ArchiveSpriteDefinition, 'animation' | 'loop'>;
type ArchiveOptions = Omit<ArchiveSpriteOptions, 'foot' | 'name' | 'sharedAnimations'>;

export async function prewarmCachedBuilds(assets: ArchiveSpriteAssets, archives: readonly string[]): Promise<void> {
  await Promise.all(archives.map(archive => assets.loadBuild(archive)));
}

/** A manager's shared display resources. Declaring a source performs no IO; its display loads it on demand. */
export class SpriteResources {
  readonly archives: ArchiveSpriteAssets;
  private readonly archiveSources = new Map<string, ArchiveSpriteSource>();
  private disposed = false;

  /** `archives` shares an existing archive owner, such as the ground items' with their equipment art; these resources then release it. */
  constructor(
    base = `${import.meta.env.BASE_URL}dst/data/anim`,
    materialName = 'sprite',
    archives = new ArchiveSpriteAssets(materialName, base),
  ) {
    this.archives = archives;
  }

  archive(definition: ArchiveDefinition, options: ArchiveOptions = {}): ArchiveSpriteSource {
    const key = JSON.stringify([definition, options]);
    let source = this.archiveSources.get(key);
    if (!source) {
      let loaded: Awaited<ReturnType<typeof preloadSharedArchiveSprite>> | undefined;
      let pending: Promise<NonNullable<typeof loaded>> | undefined;
      let frames: SharedArchiveFrames | Promise<SharedArchiveFrames> | undefined;
      source = {
        create: clip => {
          if (this.disposed) {
            throw new Error('Sprite resources disposed');
          }
          const appearance = clip.source ? { artSource: clip.source } : undefined;
          if (loaded) {
            return loaded(clip.name, clip.loop, undefined, appearance);
          }
          pending ??= preloadSharedArchiveSprite(this.archives, definition, options).then(
            create => (loaded = create),
            error => {
              pending = undefined;
              throw error;
            },
          );
          return pending.then(create => {
            if (this.disposed) {
              throw new Error('Sprite resources disposed');
            }
            return create(clip.name, clip.loop, undefined, appearance);
          });
        },
        frames: () => {
          if (this.disposed) {
            throw new Error('Sprite resources disposed');
          }
          frames ??= preloadSharedArchiveFrames(this.archives, definition).then(
            shared => (frames = shared),
            error => {
              frames = undefined;
              throw error;
            },
          );
          return frames;
        },
      };
      this.archiveSources.set(key, source);
    }
    return source;
  }

  /** The owner first removes its entities, then releases their shared resources. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.archives.dispose();
    this.archiveSources.clear();
  }
}
