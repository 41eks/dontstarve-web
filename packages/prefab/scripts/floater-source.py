"""standardcomponents.lua MakeInventoryFloatable(inst, size, offset, scale, swap_bank, float_index, swap_data) as each
item prefab's constructor calls it, followed by the floater:Set* calls its constructor chain makes after it: the
floater settings of an item, or None for an item without a floater."""

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
    text = re.sub(r'--[^\n]*', '', text).strip()
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
        if items and all(re.match(r'^\w+\s*=', item) for item in items):
            return {key.strip(): lua_value(value, env) for key, value in (item.split('=', 1) for item in items)}
        return [lua_value(item, env) for item in items]
    if text in env:
        return env[text]
    raise ValueError(f'Unresolved Lua value: {text}')


def call_args(text, env=None):
    """MakeInventoryFloatable's arguments after `inst`, padded to all six. Without swap_bank, swap_data only resets a
    re-skinned default anim, which is not drawn here, so it is not resolved."""
    args = split_args(text)
    if args[0] != 'inst':
        raise ValueError(f'MakeInventoryFloatable on {args[0]}')
    values = [lua_value(arg, env) for arg in args[1:6]] + [None] * 5
    values = values[:5] + [lua_value(args[6], env) if len(args) > 6 and values[3] else None]
    return values


CALL = r'MakeInventoryFloatable\(([^\n]*)\)'
SET = r'inst\.components\.floater:(SetSize|SetVerticalOffset|SetScale|SetBankSwapOnFloat)\(([^\n]*)\)'


def apply_sets(args, body, env, start=0):
    """The floater:Set* calls in `body` from `start` on, applied to MakeInventoryFloatable's arguments in order."""
    args = list(args)
    for match in re.finditer(SET, body[start:]):
        method, values = match[1], split_args(match[2])
        if method == 'SetSize':
            args[0] = lua_value(values[0], env)
        elif method == 'SetVerticalOffset':
            args[1] = lua_value(values[0], env) if values else None
        elif method == 'SetScale':
            # Floater:SetScale(nil) keeps the scale.
            scale = lua_value(values[0], env)
            if scale is not None:
                args[2] = scale
        else:
            # SetBankSwapOnFloat(false, ...) only turns the swap off; its swap_data is for re-skinning, not drawn here.
            swap = lua_value(values[0], env)
            args[3] = swap
            if swap:
                args[4] = lua_value(values[1], env) if len(values) > 1 else None
                args[5] = lua_value(values[2], env) if len(values) > 2 else args[5]
    return args


def settings(args):
    """The floater's size, vertical offset, scale and bank swap, as the catalog stores them."""
    size, offset, scale, swap_bank, float_index, swap_data = (list(args) + [None] * 6)[:6]
    floater = {'size': size or 'small'}
    if offset is not None:
        floater['verticalOffset'] = offset
    if scale is not None:
        floater['scale'] = scale
    if swap_bank:
        data = swap_data or {}
        build = data.get('sym_build')
        if build is None:
            raise ValueError('A bank swap without a swap build')
        floater['bankSwap'] = {
            # Floater:SetBankSwapOnFloat: float_index or 1.
            'floatIndex': float_index if float_index is not None else 1,
            'build': build,
            # Floater:SwitchToFloatAnim: swap_data.sym_name or swap_data.sym_build.
            'symbol': data.get('sym_name') or build,
        }
    return floater


BLOCK = re.compile(r'--\[(=*)\[.*?\]\1\]|--[^\n]*|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|\[(=*)\[.*?\]\2\]|\b(function|if|do|repeat|end|until)\b', re.S)


def function_body(text, name):
    """The body of `function name(...)` or `name = function(...)`, up to the `end` that closes it: blocks are matched
    by keyword (function / if / do / repeat against end / until), skipping strings and comments."""
    match = re.search(
        r'^[ \t]*(?:(?:local\s+)?function\s+' + re.escape(name) + r'\s*\([^)]*\)|' + re.escape(name)
        + r'\s*=\s*function\s*\([^)]*\))[^\n]*\n',
        text, re.M)
    if not match:
        return None
    depth = 1
    for token in BLOCK.finditer(text, match.end()):
        keyword = token[3]
        if keyword in ('function', 'if', 'do', 'repeat'):
            depth += 1
        elif keyword in ('end', 'until'):
            depth -= 1
            if depth == 0:
                return text[match.end():token.start()]
    return None


def traced_chain(text, name, seen=None):
    """The constructor chain down to the MakeInventoryFloatable call: (body, position after the call into the next
    function or after MakeInventoryFloatable itself) from the constructor inwards, or None."""
    seen = seen or set()
    if name in seen:
        return None
    seen.add(name)
    body = function_body(text, name)
    if body is None:
        return None
    calls = list(re.finditer(CALL, body))
    if calls:
        return [(body, calls[-1].end())]
    for helper in re.finditer(r'\b([\w.]+)\(', body):
        inner = traced_chain(text, helper[1], seen)
        if inner is not None:
            return [(body, helper.end())] + inner
    return None


def local_env(text):
    """`local NAME = <literal>` values, tables over several lines included."""
    env = {}
    for match in re.finditer(r'^\s*local\s+(\w+)\s*=\s*(\{|"[^"\n]*"|-?[\d.]+\s*$)', text, re.M):
        value = match[2]
        if value == '{':
            depth, start = 0, match.end() - 1
            for index in range(start, len(text)):
                depth += {'{': 1, '}': -1}.get(text[index], 0)
                if depth == 0:
                    value = text[start:index + 1]
                    break
        try:
            env[match[1]] = lua_value(value)
        except ValueError:
            pass
    return env


def chain_floater(text, chain, call_env=None):
    """MakeInventoryFloatable in the chain's innermost function, then the floater:Set* calls each function makes after it,
    innermost first, each in its own locals."""
    file_env = local_env(text)
    body, position = chain[-1]
    call = re.findall(CALL, body[:position])[-1]
    env = file_env | local_env(body) | (call_env or {})
    args = apply_sets(call_args(call, env), body, env, position)
    for outer, after in reversed(chain[:-1]):
        args = apply_sets(args, outer, file_env | local_env(outer), after)
    return settings(args)


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


def constructor_of(text, item):
    """The function a literal Prefab("item", fn, ...) names."""
    match = re.search(r'Prefab\("' + re.escape(item) + r'",\s*([\w.]+)\s*[,)]', text)
    return match and match[1]


def floater(scripts, item, source, read):
    """The floater settings of `item`, made by `source`.lua's constructor, or None."""
    text = read(source)
    if 'MakeInventoryFloatable' not in text:
        return None
    if source in ('axe', 'pickaxe', 'shovel', 'hammer', 'farm_hoe'):
        # The fumarole variants' SetBankSwapOnFloat calls are in their callbacks, not the constructor.
        maker = re.search(r'^local function (Make\w+)\(name', text, re.M)[1]
        return tool_floater(text, maker, item)
    if source == 'staff':
        # commonfn(colour, ...): anim = colour.."staff", floater_swap_data.sym_name = "swap_"..anim; the colour's own
        # function may then swap at another frame or rescale.
        constructor = constructor_of(text, item)
        colour = re.search(r'\w+\("(\w+)"', function_body(text, constructor))[1]
        swap = {'floater_swap_data': {'sym_build': 'swap_staffs', 'sym_name': f'swap_{colour}staff'}}
        return chain_floater(text, traced_chain(text, constructor), swap)
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
    if source == 'trinkets':
        # MakeTrinket(num) fn: SMALLFLOATS[num]'s scale and vertical offset, when it lists the trinket.
        args = call_args(re.search(CALL, text)[1])
        small = re.search(r'^\s*\[' + item.split('_')[1] + r'\]\s*=\s*(\{[^{}]*\})', table_entry(text, 'SMALLFLOATS'), re.M)
        if small:
            args[2], args[1] = lua_value(small[1])
        return settings(args)
    if source == 'spoiledfood':
        # Prefab(name, function() return fn(<kind>_init, ...) end): fn floats it, then calls its init.
        init = re.search(r'Prefab\("' + re.escape(item) + r'",\s*function\(\)\s*return fn\((\w+)', text)[1]
        # The init runs after fn's MakeInventoryFloatable, as an outer step of the chain.
        return chain_floater(text, [(function_body(text, init), 0)] + traced_chain(text, 'fn'))
    if source == 'singingshell':
        # MakeShell(octave): FLOATER_SIZES["octave"..octave], offset 0.
        sizes = lua_value('{' + table_entry(text, 'FLOATER_SIZES') + '}')
        octave = sizes['octave' + item.rsplit('octave', 1)[1]]
        return settings([octave['size'], 0.0, octave['scale']])
    if source == 'bundle':
        # MakeBundle(name, ..., setupdata): the setupdata's common_postinit floats it, when it does.
        setup = split_args(re.search(r'MakeBundle\("' + re.escape(item) + r'",([^\n]*)\)', text)[1])[-1]
        calls = re.findall(CALL, table_entry(text, setup))
        return settings(call_args(calls[-1])) if calls else None
    if source == 'hats':
        # MakeHat(name): fn = fns.<kind> for the hat's name, else the default.
        name = item[:-len('hat')]
        # The branch may test several names with `or` over several lines before its `fn =`.
        chosen = re.search(r'name == "' + re.escape(name) + r'"(?:(?!\belse(?:if)?\b)[\s\S])*?\bfn = ([\w.]+)', text)
        constructor = chosen[1] if chosen else 'default'
        return chain_floater(text, traced_chain(text, constructor))
    constructor = constructor_of(text, item)
    if constructor:
        chain = traced_chain(text, constructor)
        return chain_floater(text, chain) if chain else None
    calls = set(re.findall(CALL, text))
    if len(calls) != 1:
        raise ValueError(f'{source}.lua makes {item} with one of several floaters: {sorted(calls)}')
    return settings(call_args(calls.pop(), local_env(text)))
