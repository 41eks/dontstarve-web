import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Combat } from '../../componets/src/combat';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { PlayerProx } from '../../componets/src/playerprox';
import { addComponent } from './components';
import {
  TENTACLE_PILLAR_CONFIG as CONFIG,
  type fn as Constructor,
  type OnDeath as DeathCallback,
  type OnEmerge as EmergeCallback,
  type OnEmergeOver as EmergeOverCallback,
  type OnHit as HitCallback,
  type OnLoadPostPass as LoadPostPassCallback,
  type OnSave as SaveCallback,
} from './generated/tentacle_pillar.schema';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { definePrefabIds } from './prefabRegistration';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { WORLD_SCALE } from './tile';
import type { ReadonlyVector3 } from './transform';

export const TENTACLE_PILLAR_ID = CONFIG.prefab;

// tentacle_pillar.lua SetSharedLootTable("tentacle_pillar", ...). The loot items are ground items this port does not
// draw yet, so the dropper's spawn function is a no-op: the table resolves on death, whose DropLoot is kept below.
SetSharedLootTable(CONFIG.loot.table, CONFIG.loot.entries);

export interface TentaclePillarWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** tentacle_pillar.lua fn. The teleporter, its arm children and the atrium variant are not ported. */
export class TentaclePillarInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    combat: Combat;
    playerprox: PlayerProx<TentaclePillarInstance>;
    lootdropper: LootDropper;
    inspectable: Inspectable;
    hauntable: Hauntable;
  };
  /** inst.overtaken: this pillar was overtaken into a hole; OnSave / OnPreLoad carry it. */
  overtaken?: boolean;
  /** inst.OnEmerge, called by tentacle_pillar_hole's DoEmerge to re-emerge this pillar. */
  OnEmerge?: EmergeCallback;
}

/** tentacle_pillar.lua OnSave: data.overtaken. */
const onsave: SaveCallback = (inst, data) => {
  if (inst.overtaken) {
    data.overtaken = true;
  }
};

/** tentacle_pillar.lua OnPreLoad: inst.overtaken. The unused `ents` parameter is dropped. */
function onpreload(inst: TentaclePillarInstance, data: EntityPersistData): void {
  inst.overtaken = data.overtaken ?? undefined;
}

/** tentacle_pillar.lua OnLoadPostPass: the overtaken reset; the teleporter pairing (DoRetract) is not ported. */
const onloadpostpass: LoadPostPassCallback = inst => {
  if (inst.overtaken && !inst.components.health.IsDead()) {
    inst.overtaken = undefined;
  }
  // The rest (other = inst.components.teleporter.targetTeleporter) needs the unported teleporter.
};

/**
 * tentacle_pillar.lua OnHit: followers stop hitting the pillar, then it flinches into hit and back to idle. The
 * SoundEmitter, attacker:ShakeCamera and SpawnArms (the tentacle_pillar_arm children) are not ported.
 */
const onhit: HitCallback = (inst, attacker) => {
  // Followers should stop hitting the pillar: combat:SetTarget(nil) is not ported; DropTarget clears the target.
  if (attacker.components.combat !== undefined && !attacker.hasTag('player') && Math.random() < 0.5) {
    attacker.components.combat.DropTarget();
  }
  if (!inst.components.health.IsDead()) {
    inst.AnimState.PlayAnimation(CONFIG.clips.hit.name, false);
    inst.AnimState.PushAnimation(CONFIG.clips.idle.name, true);
  }
};

/** tentacle_pillar.lua OnEmergeOver: the emerge clip finished; the pillar is targetable and idles again. */
const onemergeover: EmergeOverCallback = inst => {
  inst.removeTag('notarget');
  inst.components.health.SetInvincible(false);
  inst.AnimState.PlayAnimation(CONFIG.clips.idle.name, true);
};

/**
 * tentacle_pillar.lua OnEmerge: emerge, invulnerable and untargetable, then idle on animover. The SoundEmitter and
 * ShakeAllCameras are not ported; the caller is tentacle_pillar_hole's DoEmerge, which is also not ported.
 */
const onemerge: EmergeCallback = inst => {
  if (!inst.components.health.IsDead()) {
    inst.addTag('notarget');
    inst.components.health.SetInvincible(true);
    // PlayAnimation("emerge") then ListenForEvent("animover", OnEmergeOver).
    inst.sprite.playOnce(CONFIG.clips.emerge.name, () => onemergeover(inst));
  }
};

/**
 * tentacle_pillar.lua OnDeath: retract and drop loot; SwapToHole (the tentacle_pillar_hole and its teleporter pair) and
 * KillArms are not ported, so the pillar retracts and stays.
 */
const ondeath: DeathCallback = inst => {
  if (!inst.overtaken) {
    inst.components.lootdropper.DropLoot();
  }
  if (!inst.IsAsleep()) {
    inst.AnimState.PlayAnimation(CONFIG.clips.retract.name, false);
  }
};

function fn(world: TentaclePillarWorld, position: ReadonlyVector3): ReturnType<Constructor> {
  // PlayAnimation("idle", true): the constructor's clip loops.
  const inst = new TentaclePillarInstance(
    CONFIG.prefab,
    new SpriteState({ name: CONFIG.clips[CONFIG.initialClip].name, billboard: true }),
  );
  inst.setPosition(position.x, 0, position.z);
  inst.AddSoundEmitter();
  inst.minimap.SetIcon(CONFIG.minimapIcon);
  // standardcomponents.lua MakeObstaclePhysics adds this tag; its TypeScript counterpart only declares the collider.
  inst.addTag('blocker');
  for (const tag of CONFIG.tags) {
    inst.addTag(tag);
  }

  const health = addComponent(inst, 'health', Health, undefined, world.scheduler);
  health.SetMaxHealth(CONFIG.health.maxHealth);
  health.nofadeout = true;
  inst.ListenForEvent('death', ondeath);

  const playerprox = addComponent(inst, 'playerprox', PlayerProx<TentaclePillarInstance>, world.getWatchWorldContent);
  playerprox.SetDist(CONFIG.playerprox.near * WORLD_SCALE, CONFIG.playerprox.far * WORLD_SCALE);
  // playerprox:SetOnPlayerFar(OnFar) is not ported: it retracts the unported tentacle_pillar_arm children.
  // playerprox:SetPlayerAliveMode(AliveOnly) has no ported AliveModes enum.

  addComponent(inst, 'lootdropper', LootDropper, () => undefined).SetChanceLootTable(CONFIG.loot.table);

  addComponent(inst, 'combat', Combat, () => world.scheduler.now).onhitfn = onhit;

  addComponent(inst, 'inspectable', Inspectable);

  // AddComponent("teleporter") and AddHauntableCustomReaction(inst, CustomOnHaunt) are not ported: the teleporter is
  // missing, and CustomOnHaunt's DoRetract needs the unported health:Kill.

  inst.OnEmerge = onemerge;
  inst.OnSave = onsave;
  inst.OnPreLoad = onpreload;
  inst.OnLoadPostPass = onloadpostpass;

  return inst;
}

/** The Prefab tentacle_pillar.lua returns. tentacle_pillar_atrium (its atrium_fn) is not ported. */
export function tentaclePillarPrefabs(
  world: TentaclePillarWorld,
): Readonly<Record<typeof TENTACLE_PILLAR_ID, PrefabEntityDefinition<TentaclePillarInstance>>> {
  return {
    [TENTACLE_PILLAR_ID]: {
      fn: position => fn(world, position),
      assets: {
        animationArchive: CONFIG.archive,
        buildArchives: [CONFIG.archive],
        bank: CONFIG.bank,
      },
      assetOptions: { instancedAnimations: [CONFIG.clips.idle.name], staticBillboard: true },
      physics: { make: MakeObstaclePhysics, radius: CONFIG.physics.radius, height: CONFIG.physics.height },
      minimapIcon: CONFIG.minimapIcon,
    },
  };
}

export const tentaclePillarRegistration = {
  create: tentaclePillarPrefabs,
  families: { tentaclePillars: definePrefabIds([TENTACLE_PILLAR_ID], true) },
};
