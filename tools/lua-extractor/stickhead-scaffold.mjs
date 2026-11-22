import { localFunctionNodes, luaParameterNames, parseLuaSource, returnsValue } from './lua-source.mjs';
import { stickHeadFunctionNames } from './stickhead-signatures.mjs';

function alwaysReturns(statements) {
  const last = statements.at(-1);
  if (last?.type === 'ReturnStatement') {
    return true;
  }
  return (
    last?.type === 'IfStatement' &&
    last.clauses.at(-1).type === 'ElseClause' &&
    last.clauses.every(clause => alwaysReturns(clause.body))
  );
}

function luaComment(source, { loc, range }) {
  const first = loc.start.line;
  const last = loc.end.line;
  const label = first === last ? first : `${first}-${last}`;
  return source
    .slice(...range)
    .split(/\r\n|\n\r|[\n\r\u2028\u2029]/)
    .map((line, index) => (index === 0 ? `// Lua ${label}: ${line.trim()}` : `//   ${line.trim()}`))
    .join('\n');
}

export function emitStickHeadScaffold(source, file, selector) {
  const parsed = parseLuaSource(source);
  const nodes = localFunctionNodes(parsed);
  const topLevel = new Set(parsed.find(node => node.type === 'Chunk').body);
  const names = stickHeadFunctionNames(
    nodes.map(node => ({
      name: node.identifier.name,
      parameters: luaParameterNames(node),
      topLevel: topLevel.has(node),
      startLine: node.loc.start.line,
      startColumn: node.loc.start.column,
    })),
  );
  const index = names.findIndex(({ exportName }) => exportName === selector);
  if (index === -1) {
    throw new Error(
      `No local function named ${selector}. Available: ${names.map(({ exportName }) => exportName).join(', ')}`,
    );
  }

  const { body, parameters, loc } = nodes[index];
  const { exportName, parameterNames } = names[index];
  const occupiedNames = new Set([exportName, ...parameterNames]);
  let todo = 'TODO';
  while (occupiedNames.has(todo)) {
    todo = '_' + todo;
  }
  let hasTodo = false;
  const hole = (line, type = 'void') => {
    hasTodo = true;
    return `${todo}<${type}>(${line})`;
  };

  const render = statements =>
    statements
      .map(statement => {
        if (statement.type === 'IfStatement') {
          const branches = statement.clauses.map((clause, index) => {
            if (clause.type === 'ElseClause') {
              return `} else {\n${render(clause.body)}`;
            }
            const keyword = index === 0 ? 'if' : '} else if';
            const condition = clause.condition;
            return `${keyword} (\n${luaComment(source, condition)}\n${hole(condition.loc.start.line, 'boolean')}\n) {\n${render(clause.body)}`;
          });
          return `${branches.join('\n')}\n}`;
        }
        const comment = luaComment(source, statement);
        const line = statement.loc.start.line;
        if (statement.type === 'ReturnStatement') {
          return statement.arguments.length
            ? `${comment}\nreturn ${hole(line, 'ReturnType<LuaSignature>')};`
            : `${comment}\nreturn;`;
        }
        return `${comment}\n${hole(line)};`;
      })
      .join('\n');

  const statements = render(body);
  const fallthrough =
    returnsValue(body) && !alwaysReturns(body)
      ? `\n// Lua ${loc.end.line}: fill the fallthrough return.\nreturn ${hole(loc.end.line, 'ReturnType<LuaSignature>')};`
      : '';
  const helper = hasTodo
    ? `function ${todo}<T>(line: number): T {\n  throw new Error(${JSON.stringify('Fill ' + file + ':')} + line);\n}\n`
    : '';
  const args = parameterNames.map((name, index) => (parameters[index].type === 'VarargLiteral' ? '...' + name : name));
  const unused = parameterNames.length ? `void [${parameterNames.join(', ')}];\n` : '';
  return `// Scaffold from ${file}:${loc.start.line}.
import type { ${exportName} as LuaSignature } from './stickheads.schema';

${helper}
export const ${exportName}: LuaSignature = (${args.join(', ')}) => {
${unused}${statements}${fallthrough}
};
`;
}
