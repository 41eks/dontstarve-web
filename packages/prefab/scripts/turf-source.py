"""Read vanilla AddTile arguments shared by turf item and terrain importers."""
import re


def read_tiles(scripts):
    source = (scripts / 'tiledefs.lua').read_text()
    # Vanilla definitions contain literal tables; remove comments before splitting
    # arguments, retaining strings (including commas in ground names).
    source = re.sub(r'"(?:\\.|[^"\\])*"|--[^\n]*',
                    lambda m: '' if m[0].startswith('--') else m[0], source)
    constants = (scripts / 'constants.lua').read_text()
    ground = re.search(r'\bGROUND\s*=\s*\{(.*?)\}', constants, re.S)[1]
    legacy = {name: int(value) for name, value in re.findall(r'(\w+)\s*=\s*(\d+)', ground)}
    next_land_id = int(re.search(r'WORLD_TILES_LAND_START\s*=\s*(\d+)', constants)[1])
    render_order = 0
    tiles = []
    for match in re.finditer(r'TileManager.AddTile\(', source):
        args, start, depth, quoted, escaped = [], match.end(), 0, False, False
        for pos in range(start, len(source)):
            char = source[pos]
            if quoted:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char in '({[':
                depth += 1
            elif char == ')' and depth == 0:
                args.append(source[start:pos].strip())
                break
            elif char in ')}]':
                depth -= 1
            elif char == ',' and depth == 0:
                args.append(source[start:pos].strip())
                start = pos + 1
        else:
            raise ValueError('Unclosed AddTile call')

        def fields(index):
            if index >= len(args):
                return {}
            return {m[1]: m[2] if m[2] is not None else m[3]
                    for m in re.finditer(r'\b(\w+)\s*=\s*(?:"([^"]*)"|(true|false))', args[index])}

        name = args[0].strip('"')
        terrain = fields(3)
        tile = {'name': name, 'ground': terrain, 'turf': fields(5), 'renderOrder': render_order}
        if terrain:
            render_order += 1
        if args[1] == 'TileRanges.LAND':
            old = re.search(r'old_static_id\s*=\s*GROUND\.(\w+)', args[2])
            legacy_id = legacy.get(old[1]) if old else None
            tile['tileId'] = legacy_id if legacy_id is not None else next_land_id
            if legacy_id is None:
                next_land_id += 1
        tiles.append(tile)
    return tiles
