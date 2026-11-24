import type { AcidGlobsJson, PrefabDisplay, SpriteResources } from '@dontstarve-web/display';
import { createSignal, readonlySignal, type Signal } from '@dontstarve-web/signals';
import { AnimState } from '../../componets/src/animstate';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { animationLengths } from './animationTimings';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';

export const ACIDSMOKE_ENDLESS_ID = 'acidsmoke_endless';
/** acidraindrop.lua assets_endless: Asset("ANIM", "anim/nitre_smoke_dense_fx.zip"), bank and build of that name. */
const ARCHIVE = 'nitre_smoke_dense_fx.zip';
const LENGTHS = animationLengths(ARCHIVE);
let nextId = 0;

/** acidsmoke_endless and what acidraindrop.lua keeps on it, followed by its owner's swap_acidglob symbol. */
export interface AcidSmokeEndless {
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  readonly animstate: AnimState;
  readonly owner: PrefabInstance;
  readonly key: string;
  /** inst:Show() / inst:Hide(). */
  readonly shown: Signal<boolean>;
  /** RestartFx's AnimState:SetScale(r, r). */
  scale: number;
  /** Follower:FollowSymbol's symbol. */
  symbol: string;
  _queue_hide?: boolean;
}

/** The follower as the owner's display merges it: at the followed symbol's layer, at the smoke's own scale. */
function declare(inst: AcidSmokeEndless): void {
  inst.owner.sprite.attachFx(inst.key, {
    sprite: inst.instance.sprite,
    display: inst.display,
    active: readonlySignal(inst.shown),
    sortLayer: 2,
    composite: { symbol: inst.symbol, scale: inst.scale },
  });
}

/** RestartFx: a random scale and one of smoke_1..3. */
function RestartFx(inst: AcidSmokeEndless): void {
  inst.scale = 0.4 * Math.random() + 0.1;
  const clip = `smoke_${1 + Math.floor(Math.random() * 3)}`;
  inst.animstate.PlayAnimation(clip);
  inst.instance.sprite.playOnce(clip);
  declare(inst);
}

/** OnAnimOverEndless: hide if asked to, otherwise puff again in 3-5 seconds. */
function OnAnimOverEndless(inst: AcidSmokeEndless): void {
  if (inst._queue_hide) {
    inst._queue_hide = undefined;
    inst.shown.set(false);
  } else {
    inst.instance.DoTaskInTime(3 + 2 * Math.random(), () => RestartFx(inst));
  }
}

/** inst.DoCustomHide (EndlessHide): hidden when the current puff ends. */
function EndlessHide(inst: AcidSmokeEndless): void {
  inst._queue_hide = true;
}

/** inst.DoCustomShow (EndlessShow). */
function EndlessShow(inst: AcidSmokeEndless): void {
  inst.shown.set(true);
  OnAnimOverEndless(inst);
}

/** Follower:FollowSymbol(owner.GUID, symbol). */
function FollowSymbol(inst: AcidSmokeEndless, symbol: string): void {
  inst.symbol = symbol;
  declare(inst);
}

/**
 * acidraindrop.lua endlessfn, as mushtree.lua MakeAcidSmokeForSymbol spawns it: a non-networked, nonpersistent FX that
 * follows `symbol` on `owner`, starts hidden, and is removed with the owner. Its owner's display draws it.
 */
function spawnAcidSmokeEndless(
  owner: PrefabInstance,
  symbol: string,
  sprites: SpriteResources,
  scheduler: GameTimeScheduler,
): AcidSmokeEndless {
  const { instance, display } = createArchiveEntity(
    ACIDSMOKE_ENDLESS_ID,
    sprites.archive({ animationArchive: ARCHIVE, buildArchives: [ARCHIVE], bank: 'nitre_smoke_dense_fx' }),
    { name: 'smoke_1', none: true, billboard: true },
    ACIDSMOKE_ENDLESS_ID,
    fx => {
      fx.addTag('FX');
      fx.persists = false;
    },
    owner.status,
  );
  instance.BindScheduler(scheduler);
  const animstate = new AnimState(scheduler, LENGTHS, event => instance.PushEvent(event));
  const inst: AcidSmokeEndless = {
    instance,
    display,
    animstate,
    owner,
    key: `${ACIDSMOKE_ENDLESS_ID}:${nextId++}`,
    shown: createSignal(true),
    scale: 1,
    symbol,
  };
  RestartFx(inst);
  instance.ListenForEvent('animover', () => OnAnimOverEndless(inst));
  instance.onRemove(() => {
    animstate.dispose();
    owner.sprite.detachFx(inst.key);
  });
  // ListenForEvent("onremove", ..., inst): the smoke goes with the tree.
  owner.onRemove(() => instance.remove());
  // MakeAcidSmokeForSymbol: acidsmoke:Hide().
  inst.shown.set(false);
  return inst;
}

/**
 * mushtree.lua's client half: MakeAcidSmokeForSymbol(inst, 1..3) and its acidphasedirty / bloomeddirty listeners. The
 * smoke follows swap_acidglob<i> (swap_acidglob_bloom<i> while bloomed) and shows for its glob or all of them.
 */
export function MakeAcidSmokes(
  owner: PrefabInstance,
  globs: AcidGlobsJson,
  sprites: SpriteResources,
  scheduler: GameTimeScheduler,
): readonly AcidSmokeEndless[] {
  const smokes = [1, 2, 3].map(index => spawnAcidSmokeEndless(owner, `swap_acidglob${index}`, sprites, scheduler));
  // CLIENT_OnSmokeNumberDirty, on each change of the smoke number.
  owner.onRemove(
    globs.smokeNumber.subscribe(number => {
      smokes.forEach((smoke, i) => {
        if (number !== 0 && (number === 4 || number === i + 1)) {
          EndlessShow(smoke);
        } else {
          EndlessHide(smoke);
        }
      });
    }),
  );
  // CLIENT_OnBloomedDirty, then on each change.
  const follow = (bloomed: boolean) =>
    smokes.forEach((smoke, i) => FollowSymbol(smoke, `swap_acidglob${bloomed ? '_bloom' : ''}${i + 1}`));
  follow(globs.bloomed.peek());
  owner.onRemove(globs.bloomed.subscribe(follow));
  return smokes;
}
