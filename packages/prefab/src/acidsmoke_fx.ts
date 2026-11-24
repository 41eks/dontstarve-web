import type { SpriteResources } from '@dontstarve-web/display';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { AcidSmokeFx } from '../../componets/src/acidinfusible';
import { AnimState } from '../../componets/src/animstate';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { animationLengths } from './animationTimings';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';

export const ACIDSMOKE_FX_ID = 'acidsmoke_fx';
/** acidsmoke_fx.lua assets: Asset("ANIM", "anim/acidsmoke.zip"), bank and build acidsmoke. */
const ARCHIVE = 'acidsmoke.zip';
const LENGTHS = animationLengths(ARCHIVE);
const INTERVAL_MAX = 8;
const INTERVAL_MIN = 5;
const FRAMES = 1 / 30;
// A child is shown for as long as it exists; its removal takes the declaration away.
const SHOWN = readonlySignal(createSignal(true));
let nextId = 0;

/** The acidsmoke_fx entity and what acidsmoke_fx.lua keeps on it (`inst._anim`). */
export interface AcidSmoke extends AcidSmokeFx {
  readonly instance: PrefabInstance;
  readonly animstate: AnimState;
  _anim: string;
}

/** inst.PlayAnim: AnimState:PlayAnimation(inst._anim), on the logical clip and the drawn one. */
function PlayAnim(inst: AcidSmoke): void {
  inst.animstate.PlayAnimation(inst._anim);
  inst.instance.sprite.playOnce(inst._anim);
}

/** inst.OnAnimOver: the next puff after a random pause. */
function OnAnimOver(inst: AcidSmoke): void {
  inst.instance.DoTaskInTime(INTERVAL_MIN + Math.random() * (INTERVAL_MAX - INTERVAL_MIN), () => PlayAnim(inst));
}

/** inst.SetLevel: the next puff plays idle_<level>. */
function SetLevel(inst: AcidSmoke, level: number): void {
  inst._anim = `idle_${level}`;
}

/**
 * AcidInfusible:KillFX on the smoke: DoTaskInTime(GetCurrentAnimationLength() - GetCurrentAnimationTime() + FRAMES,
 * Remove). Between puffs the last clip has ended, so only the frame remains.
 */
function KillFX(inst: AcidSmoke): void {
  const timer = inst.animstate.timer.peek();
  const remaining =
    timer.status === 'scheduled'
      ? timer.endTime - inst.instance.GetTime()
      : timer.status === 'paused'
        ? timer.remainingSeconds
        : 0;
  inst.instance.DoTaskInTime(remaining + FRAMES, () => inst.instance.remove());
}

/**
 * acidsmoke_fx.lua fn, spawned by AcidInfusible:SpawnFX as `owner`'s child (inst:SpawnChild): a nonpersistent FX entity
 * at the owner's origin, drawn after it (SetFinalOffset(3)), that sleeps and is removed with the owner. It starts with
 * no clip playing and puffs idle_<level> every 5-8 seconds after its previous puff.
 */
export function spawnAcidSmokeFx(owner: PrefabInstance, sprites: SpriteResources, scheduler: GameTimeScheduler) {
  const { instance, display } = createArchiveEntity(
    ACIDSMOKE_FX_ID,
    sprites.archive(
      { animationArchive: ARCHIVE, buildArchives: [ARCHIVE], bank: 'acidsmoke' },
      { dynamicParent: true },
    ),
    { name: 'idle_1', none: true, billboard: true },
    ACIDSMOKE_FX_ID,
    fx => {
      fx.addTag('FX');
      fx.persists = false;
    },
    owner.status,
  );
  instance.BindScheduler(scheduler);
  owner.AddChild(instance);
  const key = `${ACIDSMOKE_FX_ID}:${nextId++}`;
  owner.sprite.attachFx(key, { sprite: instance.sprite, display, active: SHOWN, sortLayer: 2 });
  const animstate = new AnimState(scheduler, LENGTHS, event => instance.PushEvent(event));
  const inst: AcidSmoke = {
    instance,
    animstate,
    _anim: 'idle_1',
    SetLevel: level => SetLevel(inst, level),
    Kill: () => KillFX(inst),
  };
  instance.onRemove(() => {
    animstate.dispose();
    owner.sprite.detachFx(key);
  });
  instance.ListenForEvent('animover', () => OnAnimOver(inst));
  OnAnimOver(inst);
  return inst;
}
