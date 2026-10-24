import type { ItemEntity } from '@dontstarve-web/inventory';
import { Instrument } from '../../componets/src/instrument';
import { Tool } from '../../componets/src/tool';

export const PANFLUTE_ID = 'panflute';
export const PANFLUTE_SLEEPTIME = 20;
export const PANFLUTE_SLEEPRANGE = 15;
export const PANFLUTE_USES = 10;
/** The sleepiness HearPanFlute adds to each sleeper in range. */
const PANFLUTE_SLEEPINESS = 10;

/** What panflute.lua reads from an entity that hears it. */
export interface PanfluteListener {
  hasTag(tag: string): boolean;
  readonly components: { sleeper?: { AddSleepiness(sleepiness: number, sleeptime: number): void } };
}

export type PanfluteInstrument = Instrument<unknown, PanfluteListener>;

/**
 * panflute.lua HearPanFlute for the ported branches: sleepers that are not players fall asleep.
 * Rider mounts, farmplanttendable, grogginess, knockedout and the Wortox buff/skills need unported components.
 */
function HearPanFlute(listener: PanfluteListener, musician: unknown): void {
  if (listener === musician || listener.hasTag('player') || !listener.hasTag('sleeper')) return;
  listener.components.sleeper?.AddSleepiness(PANFLUTE_SLEEPINESS, PANFLUTE_SLEEPTIME);
}

/** panflute.lua: a finite-use `flute` instrument whose PLAY tool action costs one use. */
export function configurePanfluteEntity(entity: ItemEntity): void {
  entity.addTag('flute');
  entity.components.finiteuses.setMaxUses(PANFLUTE_USES);
  entity.components.finiteuses.setConsumption('PLAY', 1);
  const instrument: PanfluteInstrument = new Instrument(entity);
  instrument.SetRange(PANFLUTE_SLEEPRANGE);
  instrument.SetOnHeardFn(HearPanFlute);
  entity.components.instrument = entity.component('instrument', () => instrument);
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('PLAY');
    return tool;
  });
}
