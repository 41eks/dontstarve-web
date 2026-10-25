"""Read literal tables in development DST snapshots without executing Lua."""
import math
import re


TOKEN = re.compile(r'\s+|--[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[{}\[\]=,;]', re.S)


def string_value(token):
    def unescape(match):
        value = match[1]
        if value[0].isdigit():
            return chr(int(value))
        return {'n': '\n', 'r': '\r', 't': '\t', 'a': '\a', 'b': '\b', 'f': '\f',
                'v': '\v', '\n': '\n', '\r\n': '\n', '\\': '\\', '"': '"', "'": "'"}[value]
    return re.sub(r'\\(\d{1,3}|\r\n|.)', unescape, token[1:-1], flags=re.S)


class LiteralReader:
    def __init__(self, text, position=0):
        self.text, self.position = text, position
        self.token = None
        self.advance()

    def advance(self):
        while self.position < len(self.text):
            match = TOKEN.match(self.text, self.position)
            if not match:
                raise ValueError(f'Unsupported Lua syntax at byte {self.position}')
            self.position = match.end()
            self.token = match[0]
            if not self.token.isspace() and not self.token.startswith('--'):
                return
        self.token = None

    def expect(self, token):
        if self.token != token:
            raise ValueError(f'Expected {token!r}, got {self.token!r}')
        self.advance()

    def value(self, final=False):
        """`final` stops at the closing brace, so bytes after a top-level table are never tokenized."""
        token = self.token
        if token == '{':
            self.advance()
            result, index, keyed = {}, 1, False
            while self.token != '}':
                if self.token == '[':
                    self.advance()
                    key = self.value()
                    self.expect(']')
                    self.expect('=')
                    value = self.value()
                    keyed = True
                elif self.token and re.fullmatch(r'[A-Za-z_]\w*', self.token) and self.token not in ('true', 'false', 'nil'):
                    key = self.token
                    self.advance()
                    self.expect('=')
                    value = self.value()
                    keyed = True
                else:
                    key, value = index, self.value()
                    index += 1
                if key in result:
                    raise ValueError(f'Duplicate Lua table key: {key}')
                result[key] = value
                if self.token in (',', ';'):
                    self.advance()
                elif self.token != '}':
                    raise ValueError('Expected table separator')
            if not final:
                self.advance()
            return result if keyed else list(result.values())
        if token and token[0] in ('"', "'"):
            result = string_value(token)
        elif token in ('true', 'false', 'nil'):
            result = {'true': True, 'false': False, 'nil': None}[token]
        elif token and re.fullmatch(r'[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?', token):
            result = float(token) if any(c in token for c in '.eE') else int(token)
            if not math.isfinite(result):
                raise ValueError('Nonfinite Lua number')
        else:
            raise ValueError(f'Expected literal, got {token!r}')
        self.advance()
        return result


def returned_table(text):
    match = re.search(r'\breturn\s+(?=\{)', text)
    if not match:
        raise ValueError('No literal return table found')
    return LiteralReader(text, match.end()).value()


def player_snapshot(text):
    """A dedicated server's player file: a short binary header, one returned table and a binary session trailer."""
    match = re.search(r'return\s+(?=\{)', text[:16])
    if not match:
        raise ValueError('Expected a readable DST player snapshot')
    return LiteralReader(text, match.end()).value(final=True)


def snapshot_map(text):
    match = re.search(r'tablefunctions\["map_fn"\]\s*=\s*function\(\)\s*return\s+', text)
    if not match:
        raise ValueError('Expected a readable DST development world snapshot with map_fn')
    return LiteralReader(text, match.end()).value()


def snapshot_entities(text, prefabs):
    """Read only explicitly requested prefab groups; never execute the wrapper functions."""
    groups = {}
    for prefab in prefabs:
        match = re.search(r'tablefunctions\["ents_' + re.escape(prefab)
                          + r'_fn"\]\s*=\s*function\(\)\s*return\s+', text)
        groups[prefab] = LiteralReader(text, match.end()).value() if match else []
        if not isinstance(groups[prefab], list):
            raise ValueError(f'Expected an array of {prefab} save records')
    return groups
