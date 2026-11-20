import STRINGS from './strings.json' with { type: 'json' };

export { STRINGS };

type Topic = string | readonly Topic[] | { readonly [key: string]: Topic };
type Table = { readonly [key: string]: Topic };
/** What stringutil.lua reads from the speaking inst. */
export interface SpeakerInst { readonly prefab?: string; hasTag(tag: string): boolean }
/** What GetDescription reads from the described inst. */
export interface DescribedInst { readonly prefab?: string; readonly nameoverride?: string; readonly components?: object }

const randomLine = (lines: readonly Topic[]) => lines[Math.floor(Math.random() * lines.length)];
const asString = (topic: Topic | undefined): string | undefined => typeof topic === 'string' ? topic : undefined;

/** stringutil.lua getmodifiedstring for a single modifier. */
function getmodifiedstring(topic: readonly Topic[] | Table, modifier: string | undefined): string | undefined {
  const lines = Array.isArray(topic) ? topic as readonly Topic[] : undefined;
  const table = lines ? undefined : topic as Table;
  const ret = modifier === undefined ? undefined : table?.[modifier];
  if (Array.isArray(ret) && ret.length > 0) { return asString(randomLine(ret)); }
  return asString(ret) ?? asString(table?.GENERIC) ?? (lines?.length ? asString(randomLine(lines)) : undefined);
}

function getcharacterstring(tab: Table | undefined, item: string | undefined, modifier: string | undefined): string | undefined {
  const topic = item === undefined ? undefined : tab?.[item];
  if (topic === undefined) { return undefined; }
  return typeof topic === 'string' ? topic : getmodifiedstring(topic as readonly Topic[] | Table, modifier?.toUpperCase());
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** stringutil.lua CraftOooh: ghost speech. */
function CraftOooh(): string {
  const start = (isstart: boolean) => {
    let str = isstart ? 'O' : 'o';
    for (let i = 2, l = 2 + Math.floor(Math.random() * 3); i <= l; i++) { str += Math.random() > .3 ? 'o' : 'O'; }
    return str;
  };
  let str = '', isstart = true;
  const length = 1 + Math.floor(Math.random() * 6);
  for (let i = 1; i <= length; i++) {
    str += start(isstart) + pick(['h', 'oh', 'ohh']);
    if (i !== length) {
      const c = Math.random();
      str += c <= .1 ? '! ' : c <= .2 ? '. ' : c <= .3 ? '? ' : c <= .4 ? ', ' : ' ';
      isstart = c <= .3;
    }
  }
  return str + pick(['.', '?', '!']);
}

/** GetSpecialCharacterString, for the characters the game has: wonkey and wilton are not ported. */
function GetSpecialCharacterString(inst: SpeakerInst): string | undefined {
  return inst.hasTag('mime') ? '' : inst.hasTag('playerghost') ? CraftOooh() : undefined;
}

const CHARACTERS: Readonly<Record<string, Table>> = STRINGS.CHARACTERS;
const GENERIC: Table = STRINGS.CHARACTERS.GENERIC;
const characterTable = (name: string | undefined) => name === undefined ? undefined
  : CHARACTERS[name];

/** stringutil.lua GetString. */
export function GetString(inst: SpeakerInst, stringtype: string, modifier?: string): string | undefined {
  const special = GetSpecialCharacterString(inst);
  if (special !== undefined) { return special; }
  const type = stringtype.toUpperCase();
  return getcharacterstring(characterTable(inst.prefab?.toUpperCase()), type, modifier)
    ?? getcharacterstring(GENERIC, type, modifier);
}

/** stringutil.lua GetDescription. GetDescription_AddSpecialCases' shadowlevel, foodmemory and canfix suffixes are not ported. */
export function GetDescription(inst: SpeakerInst, item: DescribedInst, modifier?: string): string {
  const special = GetSpecialCharacterString(inst);
  if (special !== undefined) { return special; }
  const itemname = (item.nameoverride ?? (item.components as { inspectable?: { nameoverride?: string } } | undefined)?.inspectable?.nameoverride ?? item.prefab)?.toUpperCase();
  return getcharacterstring(characterTable(inst.prefab?.toUpperCase())?.DESCRIBE as Table | undefined, itemname, modifier)
    ?? getcharacterstring(GENERIC.DESCRIBE as Table, itemname, modifier)
    ?? STRINGS.CHARACTERS.GENERIC.DESCRIBE_GENERIC;
}
