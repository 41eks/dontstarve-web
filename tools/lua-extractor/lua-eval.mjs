import luaparse from 'luaparse';

/**
 * A small abstract evaluator for the Lua expressions that name animation clips. A value is a list of atoms, every
 * value the expression can take: strings, and the frozen atoms below. Tables carry their fields' values.
 */
export const NIL = Object.freeze({ kind: 'nil' });
export const TRUE = Object.freeze({ kind: 'boolean', value: true });
export const FALSE = Object.freeze({ kind: 'boolean', value: false });
/** A function value: calling it gives UNKNOWN. */
export const FUNCTION = Object.freeze({ kind: 'function' });
export const NUMBER = Object.freeze({ kind: 'number' });
/** Anything the evaluator cannot follow. */
export const UNKNOWN = Object.freeze({ kind: 'unknown' });

/** Past this many atoms a value is UNKNOWN. */
const MAX_ATOMS = 64;
const MAX_DEPTH = 12;

export function parseLua(source) {
  return luaparse.parse(source, { luaVersion: '5.1', locations: true, ranges: true, scope: true });
}

export function childNodes(node) {
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

export function stringValue(node) {
  if (node?.type !== 'StringLiteral' || !/^(["'])[^\\]*\1$/.test(node.raw)) {
    return undefined;
  }
  return node.raw.slice(1, -1);
}

function atoms(...lists) {
  const out = [];
  const strings = new Set();
  for (const atom of lists.flat()) {
    if (typeof atom === 'string') {
      if (!strings.has(atom)) {
        strings.add(atom);
        out.push(atom);
      }
    } else if (atom.kind === 'table' || !out.includes(atom)) {
      out.push(atom);
    }
  }
  return out.length > MAX_ATOMS ? [UNKNOWN] : out;
}

/** Lua truthiness: true, false, or undefined when the atom could be either. */
function truthy(atom) {
  if (atom === NIL || atom === FALSE) {
    return false;
  }
  return atom === UNKNOWN ? undefined : true;
}

function typeName(atom) {
  if (typeof atom === 'string') {
    return 'string';
  }
  return atom === UNKNOWN ? UNKNOWN : atom.kind;
}

/** Lua `==` of two atoms, or undefined when the atoms do not decide it. */
function same(a, b) {
  if (a === UNKNOWN || b === UNKNOWN) {
    return undefined;
  }
  // Only nil is nil, whatever the other value is; strings compare by value; booleans and numbers by identity here.
  if (a === NIL || b === NIL || typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  // Two tables or two functions may or may not be the same object; a table is never a function.
  return a.kind === b.kind && (a.kind === 'table' || a.kind === 'function' || a.kind === 'number')
    ? undefined
    : a === b;
}

/**
 * Evaluates expressions of one Lua file. `functions` are its local functions declared once, by name, which calls are
 * followed into with their arguments bound; `domains` gives the values of expressions by source text (world state).
 */
export class LuaEvaluator {
  constructor(source, chunk, { domains = {} } = {}) {
    this.source = source;
    this.chunk = chunk;
    this.domains = domains;
    this.functions = localFunctions(chunk);
  }

  text(node) {
    return this.source.slice(...node.range);
  }

  /** The atoms `node` can be in `env` (name -> atoms; a name it lacks is UNKNOWN). */
  evaluate(node, env = new Map(), depth = 0) {
    if (!node) {
      return [NIL];
    }
    if (depth > MAX_DEPTH) {
      return [UNKNOWN];
    }
    const next = (child, scope = env) => this.evaluate(child, scope, depth + 1);
    const literal = stringValue(node);
    if (literal !== undefined) {
      return [literal];
    }
    switch (node.type) {
      case 'StringLiteral':
        return [UNKNOWN];
      case 'NilLiteral':
        return [NIL];
      case 'BooleanLiteral':
        return [node.value ? TRUE : FALSE];
      case 'NumericLiteral':
        return [NUMBER];
      case 'FunctionDeclaration':
        return [FUNCTION];
      case 'TableConstructorExpression': {
        const fields = new Map();
        for (const field of node.fields) {
          if (field.type === 'TableKeyString') {
            fields.set(field.key.name, next(field.value));
          }
        }
        return [{ kind: 'table', fields }];
      }
      case 'Identifier':
        return env.get(node.name) ?? [UNKNOWN];
      case 'MemberExpression': {
        if (node.indexer !== '.') {
          return [UNKNOWN];
        }
        const domain = this.domains[this.text(node)];
        if (domain) {
          return [...domain];
        }
        const out = [];
        for (const base of next(node.base)) {
          if (typeof base === 'object' && base.kind === 'table') {
            out.push(...(base.fields.get(node.identifier.name) ?? [NIL]));
          } else if (base !== NIL) {
            // Indexing nil is an error, so that path plays nothing; anything else is not followed.
            out.push(UNKNOWN);
          }
        }
        return atoms(out);
      }
      case 'UnaryExpression': {
        if (node.operator !== 'not') {
          return [UNKNOWN];
        }
        return atoms(
          next(node.argument).flatMap(atom => {
            const value = truthy(atom);
            return value === undefined ? [TRUE, FALSE] : [value ? FALSE : TRUE];
          }),
        );
      }
      case 'BinaryExpression': {
        const left = next(node.left);
        const right = next(node.right);
        if (node.operator === '..') {
          if ([...left, ...right].some(atom => typeof atom !== 'string')) {
            return [UNKNOWN];
          }
          return atoms(left.flatMap(a => right.map(b => a + b)));
        }
        if (node.operator === '==' || node.operator === '~=') {
          const results = [];
          for (const a of left) {
            for (const b of right) {
              const equal = same(a, b);
              if (equal === undefined) {
                results.push(TRUE, FALSE);
              } else {
                results.push(equal === (node.operator === '==') ? TRUE : FALSE);
              }
            }
          }
          return atoms(results);
        }
        return [UNKNOWN];
      }
      case 'LogicalExpression': {
        let right;
        const evaluateRight = () => (right ??= next(node.right));
        const out = [];
        for (const atom of next(node.left)) {
          const value = truthy(atom);
          if (node.operator === 'and') {
            if (value === false) {
              out.push(atom);
            } else {
              out.push(...evaluateRight());
              if (value === undefined) {
                out.push(FALSE);
              }
            }
          } else if (value === true) {
            out.push(atom);
          } else {
            out.push(...evaluateRight());
            if (value === undefined) {
              out.push(atom);
            }
          }
        }
        return atoms(out);
      }
      case 'CallExpression':
        return this.call(node, env, depth);
      default:
        return [UNKNOWN];
    }
  }

  call(node, env, depth) {
    const next = child => this.evaluate(child, env, depth + 1);
    const { base } = node;
    if (base.type === 'Identifier' && !env.has(base.name)) {
      if (base.name === 'type' && node.arguments.length === 1) {
        return atoms(next(node.arguments[0]).map(typeName));
      }
      // util.lua FunctionOrValue(func_or_val, ...): a value is returned as it is; a function is called.
      if (base.name === 'FunctionOrValue') {
        return atoms(next(node.arguments[0]).map(atom => (atom === FUNCTION ? UNKNOWN : atom)));
      }
      const fn = this.functions.get(base.name);
      if (fn) {
        const bound = this.bind(fn, node.arguments.map(next));
        const returns = returnExpressions(fn);
        if (!returns.length) {
          return [NIL];
        }
        const scope = this.scope(fn, bound, depth + 1);
        return atoms(...returns.map(expression => this.evaluate(expression, scope, depth + 1)));
      }
    }
    return [UNKNOWN];
  }

  /** `fn`'s parameters bound to `args` (atoms each); a parameter without an argument is nil. */
  bind(fn, args, outer = new Map()) {
    const env = new Map(outer);
    fn.parameters.forEach((parameter, index) => {
      if (parameter.type === 'Identifier') {
        env.set(parameter.name, args[index] ?? [NIL]);
      }
    });
    return env;
  }

  /**
   * `env` with `fn`'s locals, flow-insensitively: each local and each assignment to it adds the values its
   * expression can be, in source order. With `nested`, the locals of functions declared inside count too, and their
   * parameters, which their callers pass, are UNKNOWN.
   */
  scope(fn, env, depth = 0, nested = false) {
    const scope = new Map(env);
    const visit = node => {
      for (const child of childNodes(node)) {
        if (child.type === 'FunctionDeclaration') {
          if (nested) {
            for (const parameter of child.parameters) {
              if (parameter.type === 'Identifier') {
                scope.set(parameter.name, [UNKNOWN]);
              }
            }
            visit(child);
          }
          continue;
        }
        if (child.type === 'LocalStatement' || child.type === 'AssignmentStatement') {
          child.variables.forEach((variable, index) => {
            if (variable.type !== 'Identifier' || (child.type === 'AssignmentStatement' && !scope.has(variable.name))) {
              return;
            }
            const value = this.evaluate(child.init[index], scope, depth + 1);
            const previous =
              child.type === 'LocalStatement' && !scope.has(variable.name) ? [] : scope.get(variable.name);
            scope.set(variable.name, atoms(previous ?? [], value));
          });
        }
        visit(child);
      }
    };
    visit(fn);
    return scope;
  }
}

/** The return expressions of a function body, not those of functions declared inside it; a bare return is nil. */
export function returnExpressions(node, found = []) {
  for (const child of childNodes(node)) {
    if (child.type === 'FunctionDeclaration') {
      continue;
    }
    if (child.type === 'ReturnStatement') {
      found.push(child.arguments[0]);
    } else {
      returnExpressions(child, found);
    }
  }
  return found;
}

/** Local functions declared once in the file, by name. */
export function localFunctions(chunk) {
  const found = new Map();
  const counts = new Map();
  const visit = node => {
    if (node.type === 'FunctionDeclaration' && node.isLocal && node.identifier?.type === 'Identifier') {
      counts.set(node.identifier.name, (counts.get(node.identifier.name) ?? 0) + 1);
      found.set(node.identifier.name, node);
    }
    childNodes(node).forEach(visit);
  };
  visit(chunk);
  for (const [name, count] of counts) {
    if (count > 1) {
      found.delete(name);
    }
  }
  return found;
}
