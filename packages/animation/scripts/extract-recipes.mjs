import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('./recipes.lua', import.meta.url);
const outputUrl = new URL('../recipes.json', import.meta.url);

function longBracketEnd(source, start) {
  if (source[start] !== '[') return undefined;
  let cursor = start + 1;
  while (source[cursor] === '=') cursor++;
  if (source[cursor] !== '[') return undefined;
  return { contentStart: cursor + 1, closing: `]${'='.repeat(cursor - start - 1)}]` };
}

function skipQuotedString(source, start) {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2;
    else if (source[cursor++] === quote) break;
  }
  return cursor;
}

function skipLongString(source, start) {
  const bracket = longBracketEnd(source, start);
  if (!bracket) return undefined;
  const end = source.indexOf(bracket.closing, bracket.contentStart);
  return end < 0 ? source.length : end + bracket.closing.length;
}

function skipComment(source, start) {
  if (source.slice(start, start + 2) !== '--') return undefined;
  const longEnd = skipLongString(source, start + 2);
  if (longEnd !== undefined) return longEnd;
  const lineEnd = source.indexOf('\n', start + 2);
  return lineEnd < 0 ? source.length : lineEnd + 1;
}

function skipTrivia(source, start = 0) {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) cursor++;
    else {
      const commentEnd = skipComment(source, cursor);
      if (commentEnd === undefined) break;
      cursor = commentEnd;
    }
  }
  return cursor;
}

function matchingParen(source, open) {
  let depth = 0;
  for (let cursor = open; cursor < source.length;) {
    const character = source[cursor];
    if (character === '"' || character === "'") {
      cursor = skipQuotedString(source, cursor);
      continue;
    }
    const longEnd = skipLongString(source, cursor);
    if (longEnd !== undefined) {
      cursor = longEnd;
      continue;
    }
    const commentEnd = skipComment(source, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    if (character === '(') depth++;
    else if (character === ')' && --depth === 0) return cursor;
    cursor++;
  }
  throw new Error(`Unclosed call at byte ${open}`);
}

function findCalls(source, functionName) {
  const calls = [];
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor];
    if (character === '"' || character === "'") {
      cursor = skipQuotedString(source, cursor);
      continue;
    }
    const longEnd = skipLongString(source, cursor);
    if (longEnd !== undefined) {
      cursor = longEnd;
      continue;
    }
    const commentEnd = skipComment(source, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    if (source.startsWith(functionName, cursor)
      && !/[\w]/.test(source[cursor - 1] ?? '')
      && !/[\w]/.test(source[cursor + functionName.length] ?? '')) {
      const open = skipTrivia(source, cursor + functionName.length);
      if (source[open] === '(') {
        const close = matchingParen(source, open);
        calls.push({ offset: cursor, arguments: source.slice(open + 1, close) });
        cursor = close + 1;
        continue;
      }
    }
    cursor++;
  }
  return calls;
}

function splitTopLevel(source, delimiter = ',') {
  const parts = [];
  let start = 0;
  const closings = [];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor];
    if (character === '"' || character === "'") {
      cursor = skipQuotedString(source, cursor);
      continue;
    }
    const longEnd = skipLongString(source, cursor);
    if (longEnd !== undefined) {
      cursor = longEnd;
      continue;
    }
    const commentEnd = skipComment(source, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    if (pairs[character]) closings.push(pairs[character]);
    else if (closings.at(-1) === character) closings.pop();
    else if (!closings.length && source.startsWith(delimiter, cursor)) {
      parts.push(source.slice(start, cursor).trim());
      start = cursor + delimiter.length;
      cursor = start;
      continue;
    }
    cursor++;
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function decodeLuaString(source) {
  const quote = source[0];
  if ((quote !== '"' && quote !== "'") || source.at(-1) !== quote) return undefined;
  let result = '';
  for (let cursor = 1; cursor < source.length - 1; cursor++) {
    const character = source[cursor];
    if (character !== '\\') {
      result += character;
      continue;
    }
    const escaped = source[++cursor];
    const simple = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\x0b' };
    if (simple[escaped] !== undefined) result += simple[escaped];
    else if (escaped === 'z') {
      while (/\s/.test(source[cursor + 1] ?? '')) cursor++;
    } else if (escaped === 'x') {
      result += String.fromCodePoint(Number.parseInt(source.slice(cursor + 1, cursor + 3), 16));
      cursor += 2;
    } else if (/\d/.test(escaped ?? '')) {
      const digits = source.slice(cursor).match(/^\d{1,3}/)?.[0] ?? escaped;
      result += String.fromCodePoint(Number.parseInt(digits, 10));
      cursor += digits.length - 1;
    } else if (escaped === '\n') result += '\n';
    else result += escaped;
  }
  return result;
}

function luaExpression(source) {
  return { lua: source.trim().replace(/\s+/g, ' ') };
}

function topLevelAssignment(source) {
  const parts = splitTopLevel(source, '=');
  if (parts.length !== 2) return undefined;
  const index = source.indexOf('=');
  if ('=<>~'.includes(source[index - 1] ?? '') || source[index + 1] === '=') return undefined;
  return parts;
}

function parseCall(source) {
  const match = /^([A-Za-z_]\w*)\s*\(/.exec(source);
  if (!match) return undefined;
  const open = source.indexOf('(', match[0].length - 1);
  const close = matchingParen(source, open);
  if (source.slice(close + 1).trim()) return undefined;
  return { name: match[1], arguments: splitTopLevel(source.slice(open + 1, close)) };
}

function parseValue(source, environment = {}) {
  const value = source.trim();
  if (!value || value === 'nil') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);

  const decoded = decodeLuaString(value);
  if (decoded !== undefined) return decoded;
  if (Object.hasOwn(environment, value)) return environment[value];

  const concatenated = splitTopLevel(value, '..');
  if (concatenated.length > 1) {
    const values = concatenated.map((part) => parseValue(part, environment));
    if (values.every((part) => ['string', 'number'].includes(typeof part))) return values.join('');
  }

  const call = parseCall(value);
  if (call?.name === 'tostring' && call.arguments.length === 1) {
    const argument = parseValue(call.arguments[0], environment);
    if (typeof argument === 'string' || typeof argument === 'number') return String(argument);
  }
  if (call?.name === 'Ingredient') return parseIngredient(call.arguments, environment);

  if (value[0] === '{' && value.at(-1) === '}') {
    const entries = splitTopLevel(value.slice(1, -1)).filter(Boolean);
    const keyed = entries.map(topLevelAssignment);
    if (keyed.every(Boolean)) {
      return Object.fromEntries(keyed.map(([key, entryValue]) => {
        const decodedKey = decodeLuaString(key.trim());
        const normalizedKey = decodedKey ?? key.trim().replace(/^\[|\]$/g, '');
        return [normalizedKey, parseValue(entryValue, environment)];
      }));
    }
    if (keyed.every((entry) => entry === undefined)) {
      return entries.map((entry) => parseValue(entry, environment));
    }
  }
  return luaExpression(value);
}

function parseIngredient(arguments_, environment) {
  const [type, amount, atlas, deconstruct, image] = arguments_;
  const ingredient = {
    type: parseValue(type, environment),
    amount: parseValue(amount, environment),
  };
  if (atlas && atlas.trim() !== 'nil') ingredient.atlas = parseValue(atlas, environment);
  if (deconstruct && deconstruct.trim() !== 'nil') ingredient.deconstruct = parseValue(deconstruct, environment);
  if (image && image.trim() !== 'nil') ingredient.image = parseValue(image, environment);
  return ingredient;
}

function parseIngredientList(source, environment = {}) {
  const value = source.trim();
  if (value[0] !== '{' || value.at(-1) !== '}') return parseValue(value, environment);
  return splitTopLevel(value.slice(1, -1))
    .filter(Boolean)
    .map((entry) => parseValue(entry, environment));
}

function parseTech(source, environment) {
  const match = /^TECH\.([A-Za-z_]\w*)$/.exec(source.trim());
  return match ? match[1] : parseValue(source, environment);
}

function parseRecipe2(argumentsSource, environment = {}) {
  const args = splitTopLevel(argumentsSource);
  if (args.length < 3 || args.length > 4) throw new Error(`Unexpected Recipe2 signature: ${argumentsSource}`);
  const name = parseValue(args[0], environment);
  if (typeof name !== 'string') throw new Error(`Recipe2 name is not static: ${args[0]}`);
  const ingredients = parseIngredientList(args[1], environment);
  if (!Array.isArray(ingredients)) throw new Error(`${name}: ingredients are not an array`);
  return {
    name,
    ingredients,
    tech: parseTech(args[2], environment),
    config: args[3] ? parseValue(args[3], environment) : {},
  };
}

function parseLegacyRecipe(argumentsSource) {
  const args = splitTopLevel(argumentsSource);
  const fields = [
    'name', 'ingredients', 'tab', 'tech', 'placer', 'min_spacing', 'nounlock', 'numtogive',
    'builder_tag', 'atlas', 'image', 'testfn', 'product', 'build_mode', 'build_distance',
  ];
  const parsed = Object.fromEntries(fields.map((field, index) => [
    field,
    field === 'ingredients'
      ? parseIngredientList(args[index] ?? 'nil')
      : parseValue(args[index] ?? 'nil'),
  ]));
  if (typeof parsed.name !== 'string' || !Array.isArray(parsed.ingredients)) {
    throw new Error(`Unexpected legacy Recipe signature: ${argumentsSource}`);
  }
  const config = Object.fromEntries(Object.entries(parsed)
    .filter(([field, value]) => !['name', 'ingredients', 'tab', 'tech'].includes(field) && value !== null));
  return {
    name: parsed.name,
    ingredients: parsed.ingredients,
    tech: parseTech(args[3], {}),
    config,
    legacy: true,
    ...(parsed.tab === null ? {} : { tab: parsed.tab }),
  };
}

function expandRecipe2(call) {
  const nameExpression = splitTopLevel(call.arguments)[0];
  if (!nameExpression.includes('..i')) return [parseRecipe2(call.arguments)];
  const commonAmounts = [8, 6, 4];
  const rareAmounts = [6, 4, 2];
  return commonAmounts.map((numCommonPetals, index) => parseRecipe2(call.arguments, {
    i: index + 1,
    num_common_petals: numCommonPetals,
    num_rare_petals: rareAmounts[index],
  }));
}

function parseDeconstructionRecipe(argumentsSource, environment = {}) {
  const args = splitTopLevel(argumentsSource);
  const name = parseValue(args[0], environment);
  const returnIngredients = parseIngredientList(args[1], environment);
  if (typeof name !== 'string' || !Array.isArray(returnIngredients)) {
    throw new Error(`Unexpected DeconstructRecipe signature: ${argumentsSource}`);
  }
  return {
    name,
    returnIngredients,
    config: args[2] ? parseValue(args[2], environment) : {},
  };
}

function expandDeconstructionRecipe(call) {
  const nameExpression = splitTopLevel(call.arguments)[0];
  if (!nameExpression.includes('..tostring(k)')) return [parseDeconstructionRecipe(call.arguments)];
  return [1, 2, 3].map((k) => parseDeconstructionRecipe(call.arguments, { k }));
}

function assertUniqueNames(recipes, label) {
  const seen = new Set();
  for (const { name } of recipes) {
    if (seen.has(name)) throw new Error(`Duplicate ${label} name: ${name}`);
    seen.add(name);
  }
}

const source = await readFile(sourceUrl, 'utf8');
const recipeCalls = [
  ...findCalls(source, 'Recipe2').map((call) => ({ ...call, kind: 'Recipe2' })),
  ...findCalls(source, 'Recipe').map((call) => ({ ...call, kind: 'Recipe' })),
].sort((left, right) => left.offset - right.offset);
const recipes = recipeCalls.flatMap((call) => call.kind === 'Recipe2'
  ? expandRecipe2(call)
  : [parseLegacyRecipe(call.arguments)]);
const deconstructionRecipes = findCalls(source, 'DeconstructRecipe')
  .flatMap(expandDeconstructionRecipe);

assertUniqueNames(recipes, 'recipe');
assertUniqueNames(deconstructionRecipes, 'deconstruction recipe');

const output = {
  source: 'scripts/recipes.lua',
  recipes,
  deconstructionRecipes,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputUrl, 'utf8');
  if (current !== serialized) throw new Error(`${fileURLToPath(outputUrl)} is out of date`);
  console.log(`Validated ${recipes.length} recipes and ${deconstructionRecipes.length} deconstruction recipes.`);
} else {
  await writeFile(outputUrl, serialized);
  console.log(`Wrote ${recipes.length} recipes and ${deconstructionRecipes.length} deconstruction recipes to ${fileURLToPath(outputUrl)}.`);
}
