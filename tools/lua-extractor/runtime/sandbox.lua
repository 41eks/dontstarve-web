return function(recorder, read_source, prefab_file, prefab_id, scenario, extra_requires)
    local env = {
        assert = assert, error = error, ipairs = ipairs, next = next, pairs = pairs,
        pcall = pcall, select = select, tonumber = tonumber, tostring = tostring, type = type,
        getmetatable = getmetatable, setmetatable = setmetatable, rawget = rawget, rawset = rawset,
        math = math, string = string, table = table, unpack = table.unpack,
        BRANCH = "release",

        -- Record engine-provided action identity symbolically.
        IsConsole = function() return false end,
        ACTIONS = { HAMMER = { kind = "symbol", name = "ACTIONS.HAMMER" } },
        TheWorld = { ismastersim = scenario.master, state = scenario.state or { isfullmoon = scenario.fullMoon } },
        CreateEntity = recorder.createEntity,
        Asset = function(kind, path, parameter)
            return { type = kind, path = path, parameter = parameter }
        end,
        Prefab = function(name, fn, assets, dependencies)
            return { name = name, fn = fn, assets = assets, dependencies = dependencies }
        end,
    }
    env._G = env
    env.math.pow = function(base, exponent) return base ^ exponent end
    local function load_source(file)
        return assert(load(read_source(file), "@" .. file, "t", env))
    end
    local loaded = {}
    env.require = function(name)
        if loaded[name] == nil then
            loaded[name] = true
            loaded[name] = load_source(name .. ".lua")() or true
        end
        return loaded[name]
    end

    math.randomseed(scenario.seed)
    env.require("vector3")
    env.require("constants")
    env.require("tuning")
    env.require("standardcomponents")
    -- A profile's extra source modules (util.lua's shallowcopy, prefabutil.lua's MakePlacer) load after the defaults.
    for _, name in ipairs(extra_requires or {}) do
        env.require(name)
    end
    local definitions
    -- SpawnPrefab of a prefab the same file returns runs that prefab's recorded constructor.
    recorder.setPrefabResolver(function(name)
        for i = 1, definitions.n do
            if definitions[i].name == name then
                return definitions[i].fn()
            end
        end
        error("SpawnPrefab of a prefab outside " .. prefab_file .. ": " .. name)
    end)
    env.SpawnPrefab = recorder.spawnPrefab
    definitions = table.pack(load_source(prefab_file)())

    -- skinprefabs.lua's skins of the prefab, in file order. Each skin's init_fn runs on a freshly constructed entity, as
    -- the engine applies a skin after fn. Only the init_fn's operations are kept, with the children that construction
    -- spawned (by prefab and entity id), so the main recording is not changed.
    local function record_skins(prefab)
        env.CreatePrefabSkin = function(name, info)
            info.name = name
            return info
        end
        -- prefabskin.lua requires class.lua and prefabs.lua for its Prefab class; the sandbox's Prefab stands in.
        loaded["class"] = true
        loaded["prefabs"] = true
        env.require("prefabskin")
        local skin_prefabs = table.pack(load_source("prefabs/skinprefabs.lua")())
        local operations = recorder.operations
        local skins = {}
        for i = 1, skin_prefabs.n do
            local skin = skin_prefabs[i]
            if skin.base_prefab == prefab.name then
                local mark = #operations
                local inst = prefab.fn()
                local constructed = #operations
                skin.init_fn(inst, nil)
                local spawned, skin_operations = {}, {}
                for k = mark + 1, constructed do
                    local operation = operations[k]
                    if operation.target == "global" and operation.name == "SpawnPrefab" then
                        spawned[#spawned + 1] = { prefab = operation.args[1], entity = operation.args[2].entity }
                    end
                end
                for k = constructed + 1, #operations do
                    skin_operations[#skin_operations + 1] = operations[k]
                end
                for k = #operations, mark + 1, -1 do
                    operations[k] = nil
                end
                skins[#skins + 1] = {
                    name = skin.name,
                    entity = recorder.entityId(inst),
                    spawned = spawned,
                    operations = skin_operations,
                }
            end
        end
        return skins
    end

    for i = 1, definitions.n do
        local prefab = definitions[i]
        if prefab.name == prefab_id then
            local entity = prefab.fn()
            local skins = scenario.skins and record_skins(prefab) or nil
            return {
                entity = recorder.entityId(entity),
                assets = prefab.assets,
                prefabDependencies = prefab.dependencies,
                operations = recorder.operations,
                skins = skins,
            }
        end
    end
    error("prefab not found: " .. prefab_id)
end
