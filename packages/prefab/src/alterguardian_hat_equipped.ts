import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import type { AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createSignal } from '@dontstarve-web/signals';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';

/** Where the display loads the FX entity's art: its own archive, and the item skin's build that SetSkin names. */
export interface AlterguardianHatEquippedArt {
  readonly archive: string;
  peekFactory(archive: string): AnimatedSpriteFactory | undefined;
  loadFactory(archive: string): Promise<AnimatedSpriteFactory>;
  readonly skin?: { readonly archive: string; readonly art: AnimStateArt };
}

const PREFAB = 'alterguardian_hat_equipped';
// A follower is shown for as long as it exists; its removal takes the declaration away.
const SHOWN = createSignal(true);
let nextId = 0;

/**
 * alterguardian_hat_equipped.lua: one of the crown's two layers, spawned under its owner (SpawnPrefab followed by
 * OnActivated's SetParent). Its frame is merged into the owner's at the followed symbol, as the owner draws its followers.
 */
export class AlterguardianHatEquipped {
  readonly instance: PrefabInstance;
  private readonly owner: PrefabInstance<ArchiveSpriteCommands>;
  private readonly anim: AnimState;
  private readonly art: AlterguardianHatEquippedArt;
  private readonly key = `${PREFAB}:${nextId++}`;
  private readonly display: PrefabDisplay;

  constructor(art: AlterguardianHatEquippedArt, owner: PrefabInstance<ArchiveSpriteCommands>) {
    this.art = art;
    this.owner = owner;
    const anim = this.anim = new AnimState();
    // SetBank / SetBuild("hat_alterguardian_equipped"): the display loads the archive before it draws the layer.
    const source = (factory: AnimatedSpriteFactory) => ({
      create: (name: string) => factory.create({ initialAnimation: name, name: PREFAB }),
      release: (sprite: import('three').Group) => factory.disposeSprite(sprite),
    });
    const { instance, display } = createPrefabEntity(PREFAB, {
      peek: () => { const factory = art.peekFactory(art.archive); return factory && source(factory); },
      load: () => art.loadFactory(art.archive).then(source),
    }, { name: 'idle' }, PREFAB, instance => {
      // hats.lua's empty spore container: alterguardianhat_animstatemult sets SetMultColour(0.7, 0.7, 0.7) on both entities.
      instance.sprite.setColour([0.7, 0.7, 0.7]);
      // The layer's own AnimState, by its json signal: its display follows it.
      instance.sprite.setAnimState(anim.json, art.skin?.art);
      instance.addTag('FX');
      instance.addTag('DECOR');
      instance.persists = false;
    }, owner.status);
    this.instance = instance;
    this.display = display;
    // SetSymbolMultColour("flame_swap", ...) is not ported: flame_swap only has art once SetFlameLevel overrides it.
    anim.SetSymbolLightOverride('flame_swap', 0.5);
    // SetBloomEffectHandle: approximated by a local halo of p4_piece, drawn just behind it.
    anim.SetSymbolBloom('p4_piece');
    instance.onRemove(() => owner.sprite.detachFx(this.key));
  }

  /** Follower:FollowSymbol(owner, "hair") on one side of the owner, then activate_pre into the activate_loop. */
  OnActivated(isFront: boolean): void {
    this.anim.Hide(isFront ? 'back' : 'front');
    this.owner.sprite.attachFx(this.key, { sprite: this.instance.sprite, display: this.display, active: SHOWN, sortLayer: 2,
      composite: { symbol: 'hair', finalOffset: isFront ? 1 : -1, noFaced: true } });
    this.instance.sprite.playOnce('activate_pre');
    this.instance.sprite.pushAnimation('activate_loop', true);
  }

  /** activate_pst, removed on animover. */
  OnDeactivated(): void {
    this.instance.sprite.playOnce('activate_pst', () => this.Remove());
  }

  /** The item skin replaces p4_piece and fx_glow; every other symbol stays the FX build's. */
  SetSkin(): void {
    const skin = this.art.skin;
    if (!skin) return;
    for (const symbol of ['p4_piece', 'fx_glow']) this.anim.OverrideItemSkinSymbol(symbol, skin.archive, symbol, this.key, this.art.archive);
  }

  Remove(): void { this.instance.remove(); }
}
