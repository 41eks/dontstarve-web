import luaparse from 'luaparse';

export function parseLuaSource(source) {
  const nodes = [];
  luaparse.parse(source, {
    luaVersion: '5.1',
    locations: true,
    ranges: true,
    scope: true,
    onCreateNode(node) {
      if (node.type === 'FunctionDeclaration' || node.type === 'CallExpression' || node.type === 'Chunk') {
        nodes.push(node);
      }
    },
  });
  return nodes;
}

export function localFunctionNodes(nodes) {
  return nodes
    .filter(node => node.type === 'FunctionDeclaration' && node.isLocal && node.identifier?.type === 'Identifier')
    .sort((a, b) => a.range[0] - b.range[0]);
}

export function luaParameterNames(node) {
  return node.parameters.map(parameter => (parameter.type === 'Identifier' ? parameter.name : '...'));
}

export function returnsValue(statements) {
  return statements.some(statement => {
    if (statement.type === 'ReturnStatement') {
      return statement.arguments.length > 0;
    }
    if (statement.type === 'FunctionDeclaration') {
      return false;
    }
    return (
      statement.clauses?.some(clause => returnsValue(clause.body)) || (statement.body && returnsValue(statement.body))
    );
  });
}

const LOOP_STATEMENTS = new Set(['WhileStatement', 'ForNumericStatement', 'ForGenericStatement']);
const CLAUSES = { IfClause: 'if', ElseifClause: 'elseif', ElseClause: 'else' };

function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === 'object' && typeof item.type === 'string') {
        children.push(item);
      }
    }
  }
  return children;
}

/** The lines of function bodies declared under `nodes`, which only run when those functions are called. */
function functionInteriors(nodes, interiors = []) {
  for (const node of nodes) {
    if (node.type === 'FunctionDeclaration') {
      interiors.push([node.loc.start.line + 1, node.loc.end.line]);
    } else {
      functionInteriors(childNodes(node), interiors);
    }
  }
  return interiors;
}

function loopHeaderLine(node) {
  switch (node.type) {
    case 'WhileStatement':
      return node.condition.loc.end.line;
    case 'ForNumericStatement':
      return (node.step ?? node.end).loc.end.line;
    default:
      return node.iterators.at(-1).loc.end.line;
  }
}

/**
 * The functions, `if`/`elseif`/`else` branches and loop bodies of a Lua file that no recorded scenario ran, from the
 * lines the line hook saw and the functions the call hook entered (by `linedefined`). A function never entered is
 * listed once, without its branches. A body that only shares its header's line (`if x then y() end`) cannot be told
 * apart from its condition by line coverage and is listed as indeterminate.
 */
export function unexecutedRegions(source, executedLines, enteredFunctions) {
  const chunk = luaparse.parse(source, { luaVersion: '5.1', locations: true, ranges: true });
  const lines = source.split(/\r\n|\n\r|[\n\r]/);
  const text = line => lines[line - 1].trim();
  const names = new Map();
  const functionName = node =>
    names.get(node) ?? (node.identifier ? source.slice(...node.identifier.range) : `function@${node.loc.start.line}`);
  const regions = [];

  function bodyCoverage(body, headerLine) {
    const start = Math.max(body[0].loc.start.line, headerLine + 1);
    const interiors = functionInteriors(body);
    let ownLines = false;
    for (let line = start; line <= body.at(-1).loc.end.line; line++) {
      if (interiors.some(([first, last]) => line >= first && line <= last)) {
        continue;
      }
      ownLines = true;
      if (executedLines.has(line)) {
        return 'executed';
      }
    }
    return ownLines ? 'unexecuted' : 'indeterminate';
  }

  function region(kind, coverage, startLine, body, details) {
    regions.push({
      kind,
      ...details,
      startLine,
      endLine: body.at(-1).loc.end.line,
      ...(coverage === 'indeterminate' ? { indeterminate: true } : {}),
      text: text(startLine),
    });
  }

  function visit(node, within) {
    if (node.type === 'FunctionDeclaration') {
      const name = functionName(node);
      if (!enteredFunctions.has(node.loc.start.line)) {
        regions.push({
          kind: 'function',
          name,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          text: text(node.loc.start.line),
        });
        return;
      }
      within = name;
    } else if (node.type === 'AssignmentStatement' || node.type === 'LocalStatement') {
      node.init.forEach((init, index) => {
        const variable = node.variables[index];
        if (init.type === 'FunctionDeclaration' && variable) {
          names.set(init, source.slice(...variable.range));
        }
      });
    } else if (node.type === 'TableKeyString' && node.value.type === 'FunctionDeclaration') {
      names.set(node.value, node.key.name);
    } else if (node.type === 'IfStatement') {
      for (const clause of node.clauses) {
        if (clause.condition) {
          visit(clause.condition, within);
        }
        if (!clause.body.length) {
          continue;
        }
        const header = clause.condition ? clause.condition.loc.end.line : clause.loc.start.line;
        const coverage = bodyCoverage(clause.body, header);
        if (coverage !== 'executed') {
          region('branch', coverage, clause.loc.start.line, clause.body, { clause: CLAUSES[clause.type], within });
        }
        if (coverage !== 'unexecuted') {
          for (const statement of clause.body) {
            visit(statement, within);
          }
        }
      }
      return;
    } else if (LOOP_STATEMENTS.has(node.type) && node.body.length) {
      for (const child of childNodes(node).filter(child => !node.body.includes(child))) {
        visit(child, within);
      }
      const coverage = bodyCoverage(node.body, loopHeaderLine(node));
      if (coverage !== 'executed') {
        region('loop', coverage, node.loc.start.line, node.body, { within });
      }
      if (coverage !== 'unexecuted') {
        for (const statement of node.body) {
          visit(statement, within);
        }
      }
      return;
    }
    for (const child of childNodes(node)) {
      visit(child, within);
    }
  }
  visit(chunk, 'main chunk');
  return regions.sort((a, b) => a.startLine - b.startLine);
}
