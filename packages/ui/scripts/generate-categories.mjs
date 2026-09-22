import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultScriptsRoot = "/data/copy/AssetArchive-Dev/data/Don't Starve Together/data/databundles/scripts_unpacked/scripts";
const rootArgument = process.argv.find((argument) => argument.startsWith('--scripts-root='));
const scriptsRoot = rootArgument?.slice('--scripts-root='.length)
  ?? process.env.THREE_ROAMING_DST_SCRIPTS
  ?? defaultScriptsRoot;
const recipesFilterPath = `${scriptsRoot}/recipes_filter.lua`;
const chineseStringsPath = `${scriptsRoot}/languages/chinese_s.po`;
const recipeDataUrl = new URL('../../animation/recipes.json', import.meta.url);
const outputUrl = new URL('../src/categories/generated.ts', import.meta.url);

const filterNames = [
  'CHARACTER', 'SPECIAL_EVENT', 'CRAFTING_STATION', 'TOOLS', 'LIGHT', 'PROTOTYPERS',
  'REFINE', 'WEAPONS', 'ARMOUR', 'CLOTHING', 'RESTORATION', 'COOKING', 'GARDENING',
  'FISHING', 'SEAFARING', 'CONTAINERS', 'STRUCTURES', 'MAGIC', 'RIDING', 'WINTER',
  'SUMMER', 'RAIN', 'DECOR',
];

function skipQuotedString(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2;
    else if (source[cursor++] === quote) break;
  }
  return cursor;
}

function longBracket(source, start) {
  if (source[start] !== '[') return undefined;
  let cursor = start + 1;
  while (source[cursor] === '=') cursor++;
  if (source[cursor] !== '[') return undefined;
  const closing = `]${'='.repeat(cursor - start - 1)}]`;
  const end = source.indexOf(closing, cursor + 1);
  return end < 0 ? source.length : end + closing.length;
}

function skipComment(source, start) {
  if (source.slice(start, start + 2) !== '--') return undefined;
  const blockEnd = longBracket(source, start + 2);
  if (blockEnd !== undefined) return blockEnd;
  const lineEnd = source.indexOf('\n', start + 2);
  return lineEnd < 0 ? source.length : lineEnd + 1;
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let cursor = open; cursor < source.length;) {
    const character = source[cursor];
    if (character === '"' || character === "'") {
      cursor = skipQuotedString(source, cursor);
      continue;
    }
    const blockEnd = longBracket(source, cursor);
    if (blockEnd !== undefined) {
      cursor = blockEnd;
      continue;
    }
    const commentEnd = skipComment(source, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return cursor;
    cursor++;
  }
  throw new Error(`Unclosed Lua table at byte ${open}`);
}

function decodeLuaString(source) {
  const quote = source[0];
  let result = '';
  for (let cursor = 1; cursor < source.length - 1; cursor++) {
    const character = source[cursor];
    if (character !== '\\') result += character;
    else {
      const escaped = source[++cursor];
      const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\x0b' };
      result += simple[escaped] ?? escaped;
    }
  }
  if (source.at(-1) !== quote) throw new Error(`Unclosed Lua string: ${source.slice(0, 40)}`);
  return result;
}

function stringsInTable(source) {
  const result = [];
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor];
    if (character === '"' || character === "'") {
      const end = skipQuotedString(source, cursor);
      result.push(decodeLuaString(source.slice(cursor, end)));
      cursor = end;
      continue;
    }
    const commentEnd = skipComment(source, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    cursor++;
  }
  return result;
}

function parseFilters(source) {
  const filters = {};
  const pattern = /CRAFTING_FILTERS\.([A-Z_]+)\.recipes\s*=\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf('{');
    const close = matchingBrace(source, open);
    filters[match[1]] = stringsInTable(source.slice(open + 1, close));
  }
  for (const name of filterNames) {
    if (!filters[name]) throw new Error(`Missing CRAFTING_FILTERS.${name}.recipes`);
  }
  return Object.fromEntries(filterNames.map((name) => [name, filters[name]]));
}

function parsePo(source) {
  const messages = new Map();
  let entry = {};
  let activeField;
  const finish = () => {
    if (entry.msgctxt) messages.set(entry.msgctxt, entry.msgstr || entry.msgid || '');
    entry = {};
    activeField = undefined;
  };
  for (const line of source.split(/\r?\n/)) {
    if (!line) {
      finish();
      continue;
    }
    const field = /^(msgctxt|msgid|msgstr)\s+(".*")$/.exec(line);
    if (field) {
      activeField = field[1];
      entry[activeField] = decodeLuaString(field[2]);
    } else if (activeField && line.startsWith('"')) {
      entry[activeField] += decodeLuaString(line);
    }
  }
  finish();
  return messages;
}

function stringConfig(config, key) {
  return typeof config?.[key] === 'string' ? config[key] : undefined;
}

function localized(messages, section, key) {
  return messages.get(`STRINGS.${section}.${key.toUpperCase()}`);
}

function sortedRecord(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

const [filterSource, chineseStrings, recipeJson] = await Promise.all([
  readFile(recipesFilterPath, 'utf8'),
  readFile(chineseStringsPath, 'utf8'),
  readFile(recipeDataUrl, 'utf8'),
]);
const filters = parseFilters(filterSource);
const messages = parsePo(chineseStrings);
const recipeData = JSON.parse(recipeJson);
const recipesByName = new Map(recipeData.recipes.map((recipe) => [recipe.name, recipe]));
const missingRecipes = [...new Set(Object.values(filters).flat())]
  .filter((name) => !recipesByName.has(name));
const externalRecipeIds = new Set(['petals', 'petals_evil']);
if (missingRecipes.some((name) => !externalRecipeIds.has(name))) {
  throw new Error(`Filter recipes missing from recipes.json: ${missingRecipes.join(', ')}`);
}

const recipeNames = new Map();
const recipeDescriptions = new Map();
const ingredientNames = new Map();
for (const recipe of recipeData.recipes) {
  const nameKey = stringConfig(recipe.config, 'nameoverride') ?? recipe.name;
  const descriptionKey = stringConfig(recipe.config, 'description') ?? recipe.name;
  const name = localized(messages, 'NAMES', nameKey);
  const description = localized(messages, 'RECIPE_DESC', descriptionKey);
  if (name) recipeNames.set(recipe.name, name);
  if (description) recipeDescriptions.set(recipe.name, description);
  for (const ingredient of recipe.ingredients) {
    if (typeof ingredient.type !== 'string' || ingredientNames.has(ingredient.type)) continue;
    const ingredientName = localized(messages, 'NAMES', ingredient.type);
    if (ingredientName) ingredientNames.set(ingredient.type, ingredientName);
  }
}
for (const recipeName of missingRecipes) {
  const name = localized(messages, 'NAMES', recipeName);
  const description = localized(messages, 'RECIPE_DESC', recipeName);
  if (name) recipeNames.set(recipeName, name);
  if (description) recipeDescriptions.set(recipeName, description);
}

const generated = `// Generated by scripts/generate-categories.mjs from DST recipes_filter.lua and chinese_s.po.\n`
  + `// Do not edit this file by hand.\n\n`
  + `export const filterRecipeIds = ${JSON.stringify(filters, null, 2)} as const;\n\n`
  + `export const recipeNames: Readonly<Record<string, string>> = ${JSON.stringify(sortedRecord(recipeNames), null, 2)};\n\n`
  + `export const recipeDescriptions: Readonly<Record<string, string>> = ${JSON.stringify(sortedRecord(recipeDescriptions), null, 2)};\n\n`
  + `export const ingredientNames: Readonly<Record<string, string>> = ${JSON.stringify(sortedRecord(ingredientNames), null, 2)};\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputUrl, 'utf8');
  if (current !== generated) throw new Error(`${fileURLToPath(outputUrl)} is out of date`);
  console.log(`Validated ${filterNames.length} filters with ${Object.values(filters).flat().length} recipe memberships.`);
} else {
  await writeFile(outputUrl, generated);
  console.log(`Wrote ${filterNames.length} filters with ${Object.values(filters).flat().length} recipe memberships to ${fileURLToPath(outputUrl)}.`);
}
