import type * as THREE from 'three';
import { FindEntities } from './actionEntity';
import { TILE_SIZE } from './tile';
import type { WorldFx } from './world_fx';

const LIGHTNINGSTRIKE_CANT_TAGS = ['playerghost', 'INLIMBO'];
const LIGHTNINGSTRIKE_ONEOF_TAGS = ['lightningrod'];
const LIGHTNINGSTRIKE_SEARCH_RANGE = 40 * (TILE_SIZE / 4);

export interface LightningStrikeWorld {
    root: THREE.Object3D;
    fx: Pick<WorldFx, 'prepare' | 'spawn'>;
}

/**
 * weather.lua OnSendLightningStrike (ms_sendlightningstrike): the first lightning rod within 40 units redirects the
 * strike to itself and receives `lightningstrike`; otherwise the bolt lands at `position`. lightningblocker,
 * playerlightningtarget, moonstorm lightning and StrikeLightningAtPoint's shock and fire are not ported.
 */
export async function SendLightningStrike(world: LightningStrikeWorld, position: THREE.Vector3): Promise<THREE.Vector3> {
    const [rod] = FindEntities(position, LIGHTNINGSTRIKE_SEARCH_RANGE, [], LIGHTNINGSTRIKE_CANT_TAGS, LIGHTNINGSTRIKE_ONEOF_TAGS);
    const strike = rod ? rod.getPosition().clone() : position.clone();
    // SpawnPrefab("lightning") is placed after the rod has handled the event.
    await world.fx.prepare('lightning');
    if (rod) (rod as unknown as { model: THREE.Object3D }).model.dispatchEvent({ type: 'lightningstrike' } as never);
    world.fx.spawn('lightning', strike);
    return strike;
}
