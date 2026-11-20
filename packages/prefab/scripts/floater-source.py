"""standardcomponents.lua MakeInventoryFloatable(inst, size, offset, scale, swap_bank, float_index, swap_data) as each
item prefab's constructor calls it: the floater settings of an item, or None for an item without a floater."""

import re


def split_args(text):
    """Top-level comma-separated Lua expressions."""
    parts, depth, current = [], 0, ''
    for char in text:
        if char in '({[':
            depth += 1
        elif char in ')}]':
            depth -= 1
        if char == ',' and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += char
    if current.strip():
        parts.append(current.strip())
    return parts


def lua_value(text, env=None):
    """A Lua literal: nil, a boolean, a number, a string, or a table of them; names resolve through `env`."""
    text = text.strip()
    env = env or {}
    if text == 'nil':
        return None
    if text in ('true', 'false'):
        return text == 'true'
    if re.fullmatch(r'-?(?:\d+\.?\d*|\.\d+)', text):
        return float(text)
    if re.fullmatch(r'"[^"]*"', text):
        return text[1:-1]
    if text.startswith('{') and text.endswith('}'):
        items = split_args(text[1:-1])
        if all('=' in item and not item.startswith('"') for item in items) and items:
            return {key.strip(): lua_value(value, env) for key, value in (item.split('=', 1) for item in items)}
        return [lua_value(item, env) for item in items]
    if text in env:
        return env[text]
    raise ValueError(f'Unresolved Lua value: {text}')


def call_args(text, env=None):
    """The arguments after `inst` of one MakeInventoryFloatable call's argument text."""
    args = split_args(text)
    if args[0] != 'inst':
        raise ValueError(f'MakeInventoryFloatable on {args[0]}')
    return [lua_value(arg, env) for arg in args[1:]]


def settings(args, swap_symbol=None):
    """MakeInventoryFloatable's floater:SetSize / SetVerticalOffset / SetScale / SetBankSwapOnFloat."""
    args = list(args) + [None] * (6 - len(args))
    size, offset, scale, swap_bank, float_index, swap_data = args[:6]
    floater = {'size': size or 'small'}
    if offset is not None:
        floater['verticalOffset'] = offset
    if scale is not None:
        floater['scale'] = scale
    if swap_bank:
        data = swap_symbol or swap_data or {}
        build = data.get('sym_build')
        if build is None:
            raise ValueError('A bank swap without a swap build')
        floater['bankSwap'] = {
            'floatIndex': float_index if float_index is not None else 1,
            'build': build,
            # Floater:SwitchToFloatAnim: swap_data.sym_name or swap_data.sym_build.
            'symbol': data.get('sym_name') or build,
        }
    return floater


CALL = r'MakeInventoryFloatable\(([^\n]*)\)'


def function_body(text, name):
    """The body of `local function name(...)`, up to its own `end` at the same indentation."""
    match = re.search(r'^([ \t]*)(?:local\s+)?function\s+' + re.escape(name) + r'\s*\([^)]*\)\s*\n', text, re.M)
    if not match:
        return None
    end = re.search(r'^' + re.escape(match[1]) + r'end\b', text[match.end():], re.M)
    return text[match.end():match.end() + end.start()] if end else None


def traced_call(text, name, seen=None):
    """The MakeInventoryFloatable call a constructor makes, directly or through the file's own helpers, and the body of
    the function that makes it."""
    seen = seen or set()
    if name in seen:
        return None
    seen.add(name)
    body = function_body(text, name)
    if body is None:
        return None
    calls = re.findall(CALL, body)
    if calls:
        return calls[-1], body
    for helper in re.findall(r'\b(\w+)\(', body):
        found = traced_call(text, helper, seen)
        if found is not None:
            return found
    return None


def local_env(text):
    """The file's `local NAME = <literal>` values."""
    env = {}
    for name, value in re.findall(r'^\s*local\s+(\w+)\s*=\s*(\{[^{}]*\}|"[^"]*"|-?[\d.]+)\s*$', text, re.M):
        try:
            env[name] = lua_value(value)
        except ValueError:
            pass
    return env


def table_entry(text, name):
    """The body of `name = { ... }` or `name =\\n{ ... }` in a table of entries."""
    match = re.search(r'^\s*(?:local\s+)?' + re.escape(name) + r'\s*=\s*\n?\s*\{', text, re.M)
    if not match:
        return None
    depth, start = 0, match.end() - 1
    for index in range(start, len(text)):
        if text[index] == '{':
            depth += 1
        elif text[index] == '}':
            depth -= 1
            if depth == 0:
                return text[start + 1:index]
    return None


def maker_data(text, maker, item):
    """The data table a MakeAxe-style maker gets for `item`, or {} when it passes nil."""
    call = re.search(maker + r'\("' + re.escape(item) + r'",([^\n]*)\)', text)
    if not call:
        raise ValueError(f'No {maker} call for {item}')
    data_name = split_args(call[1])[2]
    if data_name == 'nil':
        return {}
    body = table_entry(text, data_name)
    return {key: lua_value(value) for key, value in re.findall(r'^\s*(\w+)\s*=\s*("[^"]*"|\{[^{}]*\}|-?[\d.]+)\s*,', body, re.M)}


def tool_floater(text, maker, item):
    """axe / pickaxe / shovel / hammer / farm_hoe: `local x = data ~= nil and data.x or DEFAULT` and its swap data."""
    data = maker_data(text, maker, item)
    defaults = {name: lua_value(value) for name, value in re.findall(
        r'local\s+(\w+)\s*=\s*data\s*~=\s*nil\s+and\s+data\.\w+\s+or\s+("[^"]*"|\{[^{}]*\})', text)}
    env = {name: data.get(name, default) for name, default in defaults.items()}
    env['floater_swap_data'] = {'sym_build': env['swap_build'], 'sym_name': env['sym_name']}
    return settings(call_args(re.search(CALL, text)[1], env))


def make_veg_stats(text, name):
    match = re.search(r'^\s*' + re.escape(name) + r'\s*=\s*MakeVegStats\(', text, re.M)
    depth, start = 1, match.end()
    for index in range(start, len(text)):
        depth += {'(': 1, ')': -1}.get(text[index], 0)
        if depth == 0:
            return split_args(re.sub(r'--[^\n]*', '', text[start:index]))
    raise ValueError(f'Unterminated MakeVegStats for {name}')


def entry_floater(entry):
    """data.floater of a prepared food or plantable entry, else the plain MakeInventoryFloatable(inst)."""
    found = re.search(r'floater\s*=\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\})', entry or '')
    return settings(lua_value(found[1]) if found else [])


def floater(scripts, item, source, read):
    """The floater settings of `item`, made by `source`.lua's constructor, or None."""
    text = read(source)
    if 'MakeInventoryFloatable' not in text:
        return None
    if source in ('axe', 'pickaxe', 'shovel', 'hammer', 'farm_hoe'):
        maker = re.search(r'^local function (Make\w+)\(name', text, re.M)[1]
        return tool_floater(text, maker, item)
    if source == 'staff':
        # commonfn(colour, ...): anim = colour.."staff", floater_swap_data.sym_name = "swap_"..anim.
        constructor = re.search(r'Prefab\("' + re.escape(item) + r'",\s*(\w+)', text)[1]
        # The colour is the first argument of commonfn, or of blue_common that forwards it.
        colour = re.search(r'\w+\("(\w+)"', function_body(text, constructor))[1]
        call = re.search(CALL, text)[1]
        return settings(call_args(call, {'floater_swap_data': {'sym_build': 'swap_staffs', 'sym_name': f'swap_{colour}staff'}}))
    if source == 'gem':
        # buildgem(colour): FLOATER_PROPERTIES[colour].
        colour = {'opalpreciousgem': 'opal'}.get(item, item[:-len('gem')])
        props = lua_value(table_entry(text, f'["{colour}"]').join('{}'))
        return settings(['small', props[0], props[1]])
    if source == 'birds':
        # makebird: only a bird with a water_bank floats.
        rest = re.search(r'makebird\("' + re.escape(item) + r'"([^\n]*)\)', text)[1]
        has_water_bank = len([arg for arg in split_args(rest) if arg]) >= 5
        return settings(call_args(re.search(CALL, text)[1])) if has_water_bank else None
    if source == 'walls':
        # MakeWallType itemfn: item_floats for wood and hay.
        return settings([]) if item in ('wall_wood_item', 'wall_hay_item') else None
    if source == 'ruinsrelic':
        name = item[len('ruinsrelic_'):]
        return settings(call_args(re.search(CALL, text)[1], {'FLOATER_VERT_OFFSET': 0.3 if name in ('vase', 'bowl') else 0.1}))
    if source == 'mushrooms':
        # MakeMushroom: the cap's capcommonfn, the cooked cap's cookedcommonfn.
        helper = 'cookedcommonfn' if item.endswith('_cooked') else 'capcommonfn'
        return settings(call_args(re.findall(CALL, function_body(text, helper))[-1]))
    if source == 'veggies':
        if item.endswith('_seeds'):
            return settings(call_args(re.findall(CALL, function_body(text, 'fn_seeds'))[-1]))
        if item.endswith('_dried'):
            return settings(call_args(re.findall(CALL, function_body(text, 'fn_dried'))[-1]))
        cooked = item.endswith('_cooked')
        stats = make_veg_stats(text, item[:-len('_cooked')] if cooked else item)
        # float_settings / cooked_float_settings, the 10th and 11th MakeVegStats arguments.
        float_settings = lua_value(stats[10 if cooked else 9]) if len(stats) > (10 if cooked else 9) else None
        return settings(float_settings or [])
    if source == 'preparedfoods':
        for foods in ('preparedfoods', 'preparedfoods_warly'):
            entry = table_entry((scripts / (foods + '.lua')).read_text(), item)
            if entry is not None:
                return entry_floater(entry)
        raise ValueError(f'No prepared food entry for {item}')
    if source == 'plantables':
        name = item[len('dug_'):]
        entry = re.search(r'\{\s*name = "' + re.escape(name) + r'",(.*?)\n    \},', text, re.S)
        return entry_floater(entry[1])
    constructor = re.search(r'Prefab\("' + re.escape(item) + r'",\s*(\w+)\s*[,)]', text)
    if constructor:
        traced = traced_call(text, constructor[1])
        if traced is None:
            return None
        call, body = traced
        # The constructor's own locals shadow the file's.
        return settings(call_args(call, local_env(text) | local_env(body)))
    calls = set(re.findall(CALL, text))
    if len(calls) != 1:
        raise ValueError(f'{source}.lua makes {item} with one of several floaters: {sorted(calls)}')
    return settings(call_args(calls.pop(), local_env(text)))
