import { AnimState } from '@dontstarve-web/animation/animState';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';

/** The sprite commands AnimState playback is written with. */
export type AnimStateSprite = Pick<ArchiveSpriteCommands, 'start' | 'playOnce' | 'pushAnimation'>;

/**
 * inst.AnimState: one AnimState for the entity, as in Lua. Playback writes the entity's sprite json; symbol overrides
 * and layers are the inherited AnimState declaration, which takes effect once the entity declares it with
 * `sprite.setAnimState(inst.AnimState.json, art)`.
 */
export class InstanceAnimState extends AnimState {
  private readonly sprite: AnimStateSprite;

  constructor(sprite: AnimStateSprite) {
    super();
    this.sprite = sprite;
  }

  /** AnimState:PlayAnimation(name, loop): replaces the clip and clears the queue. */
  PlayAnimation(name: string, loop = false): void {
    if (loop) this.sprite.start(name);
    else this.sprite.playOnce(name);
  }

  /** AnimState:PushAnimation(name, loop); the loop the source omits is decided by the caller (see lua-api-map). */
  PushAnimation(name: string, loop = false): void { this.sprite.pushAnimation(name, loop); }
}
