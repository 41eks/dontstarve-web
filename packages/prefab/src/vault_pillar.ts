import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { Transform } from './transform';

export const VAULT_PILLAR_ID = 'vault_pillar' as const;
const VAULT_PILLAR_BOTTOM_ID = 'vault_pillar_bottom' as const;
const ASSETS = { animationArchive: 'pillar_vault_deep.zip', buildArchives: ['pillar_vault_deep.zip'], bank: 'pillar_vault' };

export interface VaultPillarWorld {
  /** SpawnPrefab for the bottom child, whose display loads its art. */
  spawnPrefab(prefab: typeof VAULT_PILLAR_BOTTOM_ID, position: ReadonlyVector3): PrefabInstance;
}

/** vault_pillar.lua fn. AttachRelic spawns the vault relics, which are not ported. */
export class VaultPillarInstance extends PrefabInstance {
  capped?: 1 | 2;
  broken?: 1;

  constructor(world: VaultPillarWorld, position: ReadonlyVector3) {
    super(VAULT_PILLAR_ID, new SpriteState({ name: 'idle_upper', billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('idle_upper'); // PlayAnimation("idle_upper"), never looping.
    this.addTag('decor');
    this.addTag('nomagic');
    this.addTag('nohighlight');

    // CreateBottom: a non-networked child that is never saved.
    const bottom = world.spawnPrefab(VAULT_PILLAR_BOTTOM_ID, position);
    bottom.entityParent = this as PrefabInstance<SpriteState, object>;
    this.onRemove(() => bottom.remove());

    this.OnSave = (_inst, data) => {
      if (this.capped !== undefined) data.capped = this.capped;
      if (this.broken !== undefined) data.broken = this.broken;
    };
    this.OnLoad = (_inst, data) => {
      if (data.capped) this.MakeCapped(data.capped);
      else if (data.broken) this.MakeBroken(true);
      else if (data.random && Math.random() < .5) this.MakeBroken(true);
    };
  }

  MakeCapped(variation: number): void {
    this.broken = undefined;
    this.capped = variation === 2 ? 2 : 1;
    this.sprite.playOnce(variation === 2 ? 'idle_upper_capped_2' : 'idle_upper_capped');
  }

  MakeBroken(broken: boolean): void {
    if (broken) {
      this.capped = undefined;
      this.broken = 1;
      this.sprite.playOnce('idle_upper_broken');
    } else if (this.broken) {
      this.broken = undefined;
      this.sprite.playOnce('idle_upper');
    }
  }
}

function createBottom(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(VAULT_PILLAR_BOTTOM_ID, new SpriteState({ name: 'idle_lower', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.persists = false;
  inst.addTag('decor');
  inst.addTag('NOCLICK');
  inst.sprite.playOnce('idle_lower'); // PlayAnimation("idle_lower"), never looping.
  return inst;
}

/** The Prefab vault_pillar.lua returns, and its bottom child. */
export function vaultPillarPrefabs(world: VaultPillarWorld): Readonly<Record<typeof VAULT_PILLAR_ID, PrefabEntityDefinition<VaultPillarInstance>>
  & Record<typeof VAULT_PILLAR_BOTTOM_ID, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [VAULT_PILLAR_ID]: {
      fn: position => new VaultPillarInstance(world, position),
      assets: ASSETS,
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    },
    [VAULT_PILLAR_BOTTOM_ID]: {
      fn: createBottom,
      assets: ASSETS,
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      targetable: false,
    },
  };
}
