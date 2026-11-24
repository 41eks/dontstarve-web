import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { PlayerProx } from '../../componets/src/playerprox';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { AnimState } from '../../componets/src/animstate';
import { animationLengths } from './animationTimings';
import { WormholeStateGraph, type WormholeStateInst } from '../../stategraphs/src/SGwormhole';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { SoundEmitter } from './soundEmitter';
import { TILE_SIZE } from './tile';

export const WORMHOLE_ID = 'wormhole' as const;
// prefabskins.lua order; wormhole_init_fn swaps the build, retaining the base bank.
export const WORMHOLE_SKINS = [
  'wormhole_claw',
  'wormhole_fantasy',
  'wormhole_gothic',
  'wormhole_lureplant',
  'wormhole_spider',
  'wormhole_worm',
] as const;
/** playerprox:SetDist(4, 5). */
export const WORMHOLE_ENTER_DISTANCE = 4 * (TILE_SIZE / 4);
export const WORMHOLE_EXIT_DISTANCE = 5 * (TILE_SIZE / 4);

/** teleporter_worm's clips, from the source anim.bin; the skins swap only the build. */
const ANIMATION_LENGTHS = animationLengths('teleporter_worm.zip');

export interface WormholeWorld {
  scheduler: GameTimeScheduler;
  /** The player positions playerprox follows. */
  getWatchWorldContent?: GetWatchWorldContent;
}

/**
 * wormhole.lua fn and its SGwormhole. The teleporter, trader, inventory and roseinspectable are not ported, so no
 * wormhole has a target: onnear opens it whenever a player comes close, where the source requires an active teleporter.
 */
export class WormholeInstance extends PrefabInstance implements WormholeStateInst {
  declare sg: ReturnType<typeof WormholeStateGraph>;
  declare SoundEmitter: SoundEmitter;
  /** inst.AnimState's playback: clips end after their source length in game time, whether or not their art is drawn. */
  animstate!: AnimState;
  constructor() {
    super(WORMHOLE_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
  }
  // conventions-allow instance-method: the AnimState call SGwormhole makes; the logical clip's end is the animover.
  playAnimation(name: string, loop = false): void {
    this.animstate.PlayAnimation(name, loop);
    if (loop) {
      this.sprite.start(name);
    } else {
      this.sprite.playOnce(name);
    }
  }
  // conventions-allow instance-method: SGwormhole's SetGroundLayering / SetBBLayering.
  setGroundLayering(ground: boolean): void {
    this.sprite.setLayer(ground ? 'background' : 'world');
    this.sprite.setMeshOrder(ground ? -0.5 : 0);
  }
}

function onnear(inst: WormholeInstance): void {
  if (!inst.sg.hasStateTag('open')) {
    inst.sg.goToState('opening');
  }
}

function onfar(inst: WormholeInstance): void {
  if (inst.sg.hasStateTag('open')) {
    inst.sg.goToState('closing');
  }
}

function fn(world: WormholeWorld): WormholeInstance {
  const inst = new WormholeInstance();
  inst.BindScheduler(world.scheduler);
  inst.AddSoundEmitter();
  inst.animstate = new AnimState(world.scheduler, ANIMATION_LENGTHS, event => inst.PushEvent(event));
  inst.onRemove(() => inst.animstate.dispose());
  inst.sprite.start('idle_loop');
  for (const tag of ['trader', 'alltrader', 'antlion_sinkhole_blocker', 'wormhole']) {
    inst.addTag(tag);
  }
  inst.SetStateGraph(inst => WormholeStateGraph(inst, world.scheduler));
  addComponent(inst, 'inspectable', Inspectable);
  return inst;
}

/** The Prefab wormhole.lua returns, with its PREFAB_SKINS. */
export function wormholePrefabs(
  world: WormholeWorld,
): Readonly<Record<typeof WORMHOLE_ID, PrefabEntityDefinition<WormholeInstance>>> {
  return {
    [WORMHOLE_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'teleporter_worm.zip',
        buildArchives: ['teleporter_worm_build.zip'],
        bank: 'teleporter_worm',
      },
      skins: Object.fromEntries(WORMHOLE_SKINS.map(id => [id, `dynamic/${id}.zip`])),
      minimapIcon: 'wormhole.png',
      onSpawned: inst => {
        // playerprox reads the position once, so it starts where the entity has spawned.
        const playerprox = addComponent(inst, 'playerprox', PlayerProx, world.getWatchWorldContent);
        playerprox.SetDist(WORMHOLE_ENTER_DISTANCE, WORMHOLE_EXIT_DISTANCE);
        playerprox.SetOnPlayerNear(() => onnear(inst));
        playerprox.SetOnPlayerFar(() => onfar(inst));
        playerprox.ForceUpdate();
      },
    },
  };
}

export const wormholeRegistration = {
  create: wormholePrefabs,
  families: { wormholes: definePrefabIds([WORMHOLE_ID], true) },
};
