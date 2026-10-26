import type * as THREE from 'three';
import type { InstancedArchiveSprites, InstancedSprite, InstancedSpriteMember } from '@dontstarve-web/animation/instancedArchiveSprites';
import type { SpriteJson } from './spriteState';
import type { LightJson } from './lightState';

const byModel = new WeakMap<THREE.Object3D, DisplaySprite>();
const byPass = new WeakMap<InstancedArchiveSprites, Set<DisplaySprite>>();

/**
 * The display layer's record of one display: the shared-batch instance it currently draws and the entity's sprite json.
 * Each instanced pass draws exactly the records listed for it; the light is the json's AnimState light override.
 */
export class DisplaySprite implements InstancedSpriteMember {
  readonly model: THREE.Object3D;
  private readonly json: { peek(): SpriteJson };
  private drawn: InstancedSprite | undefined;

  constructor(model: THREE.Object3D, json: { peek(): SpriteJson }) {
    this.model = model;
    this.json = json;
    byModel.set(model, this);
  }

  get lightOverride(): number { return this.json.peek().lightOverride ?? 0; }

  get sprite(): InstancedSprite | undefined { return this.drawn; }

  /** The display's drawn art changed: list its instance, if any, for that instance's pass. */
  setSprite(sprite: InstancedSprite | undefined): void {
    if (sprite === this.drawn) return;
    if (this.drawn) byPass.get(this.drawn.pass)?.delete(this);
    this.drawn = sprite;
    if (!sprite) return;
    let members = byPass.get(sprite.pass);
    if (!members) {
      byPass.set(sprite.pass, members = new Set());
      sprite.pass.bindMembers(members);
    }
    members.add(this);
  }

  dispose(): void {
    this.setSprite(undefined);
    byModel.delete(this.model);
  }
}

/** The light override of the display drawing `object`: the nearest display at or above it in the scene graph. */
export function displayLightOverride(object: THREE.Object3D): number {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const display = byModel.get(node);
    if (display) return display.lightOverride;
  }
  return 0;
}

/** A light the display layer lists: the declaring display's model and its entity's current inst.Light settings. */
export interface DisplayLight {
  readonly model: THREE.Object3D;
  readonly light: LightJson;
}

const lights = new Set<DisplayLight>();

/** Every light of an active entity, as its display lists it; the renderer and light sampling read only this. */
export function displayLights(): ReadonlySet<DisplayLight> { return lights; }

/** The display keeps one record listed while its entity is active and its light is on. */
export function listDisplayLight(previous: DisplayLight | undefined, model: THREE.Object3D, light: LightJson | undefined): DisplayLight | undefined {
  if (previous) lights.delete(previous);
  if (!light || light.radius <= 0 || light.intensity <= 0) return undefined;
  const record = { model, light };
  lights.add(record);
  return record;
}
