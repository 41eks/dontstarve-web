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
