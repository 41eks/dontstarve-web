local operations = {}
local proxies = {}
local next_entity = 0

local function location(info)
    return {
        file = assert(info.source:match("^@(.+)$"), "expected a named Lua source"),
        line = info.currentline,
    }
end

local function capture(value)
    local kind = type(value)
    if kind == "nil" then
        return { kind = "nil" }
    elseif kind == "function" then
        local info = debug.getinfo(value, "S")
        return {
            kind = "callback",
            file = location(info).file,
            startLine = info.linedefined,
            endLine = info.lastlinedefined,
        }
    elseif kind == "table" then
        if proxies[value] then
            return proxies[value]
        end
        local copy = {}
        for key, member in pairs(value) do
            copy[key] = capture(member)
        end
        return copy
    end
    assert(kind == "string" or kind == "number" or kind == "boolean", "unsupported value: " .. kind)
    return value
end

local function record(entity, target, kind, name, ...)
    local args = {}
    for i = 1, select("#", ...) do
        args[i] = capture(select(i, ...))
    end
    operations[#operations + 1] = {
        kind = kind,
        entity = entity,
        target = target,
        name = name,
        args = args,
        source = location(debug.getinfo(3, "Sl")),
    }
end

local function proxy(entity, target, values, methods)
    local object = setmetatable({}, {
        __index = function(_, key)
            if methods[key] then
                return methods[key]
            end
            return values[key]
        end,
        __newindex = function(_, key, value)
            record(entity, target, "write", key, value)
            values[key] = value
        end,
    })
    proxies[object] = { kind = "reference", entity = entity, target = target }
    return object
end

-- These methods are configuration sinks for the pilot. Queries require explicit semantics.
local function recorded_methods(entity, target, names)
    local methods = {}
    for _, name in ipairs(names) do
        methods[name] = function(_, ...)
            record(entity, target, "call", name, ...)
        end
    end
    return methods
end

local component_methods = {
    lootdropper = { "SetLoot", "SetLootSetupFn" },
    inspectable = {},
    workable = { "SetWorkAction", "SetWorkLeft", "SetOnWorkCallback", "SetOnFinishCallback" },
    ghostgestalter = {},
    burnable = { "SetFXLevel", "SetBurnTime", "AddBurnFX", "SetOnIgniteFn", "SetOnExtinguishFn", "SetOnBurntFn" },
    propagator = { "SetOnFlashPoint" },
    hauntable = { "SetOnHauntFn" },
    sittable = {},
    savedrotation = {},
}

local function create_entity()
    next_entity = next_entity + 1
    local entity = next_entity
    local components, tags = {}, {}
    -- inst.GUID: the recorded entity id, so a skin init_fn passing it can be matched to its entity.
    local fields = { components = components, GUID = entity }
    local methods = recorded_methods(entity, "inst", {
        "WatchWorldState", "SetDeploySmartRadius", "SetStateGraph", "DoTaskInTime", "ListenForEvent",
    })

    methods.AddTag = function(_, tag)
        record(entity, "inst", "call", "AddTag", tag)
        tags[tag] = true
    end
    methods.HasTag = function(_, tag)
        record(entity, "inst", "call", "HasTag", tag)
        return tags[tag] == true
    end
    methods.AddComponent = function(_, name)
        local names = assert(component_methods[name], "unsupported component: " .. name)
        record(entity, "inst", "call", "AddComponent", name)
        local target = "components." .. name
        local component = components[name] or proxy(entity, target, {}, recorded_methods(entity, target, names))
        components[name] = component
        return component
    end
    methods.SpawnChild = function(_, name)
        local child = create_entity()
        record(entity, "inst", "call", "SpawnChild", name, child)
        return child
    end

    local engine_methods = recorded_methods(entity, "entity", { "SetPristine", "SetParent" })
    local engine_objects = {
        Transform = { "SetNoFaced", "SetFourFaced", "SetEightFaced" },
        AnimState = {
            "SetBank", "SetBuild", "PlayAnimation", "PushAnimation", "SetLightOverride",
            "ClearOverrideSymbol", "OverrideSymbol", "SetFinalOffset", "Hide",
            -- prefabskin.lua init_fns: basic_init_fn SetSkin, and the item skin symbols of a child.
            "SetSkin", "OverrideItemSkinSymbol",
        },
        MiniMapEntity = { "SetIcon", "SetCanUseCache", "SetDrawOverFogOfWar" },
        Light = { "Enable", "SetFalloff", "SetIntensity", "SetColour", "SetRadius" },
        Physics = { "SetMass", "SetCollisionGroup", "SetCollisionMask", "SetCapsule" },
        SoundEmitter = {},
        Network = {},
    }
    for name, names in pairs(engine_objects) do
        local method = "Add" .. name
        engine_methods[method] = function()
            record(entity, "entity", "call", method)
            local object = proxy(entity, name, {}, recorded_methods(entity, name, names))
            fields[name] = object
            return object
        end
    end
    fields.entity = proxy(entity, "entity", {}, engine_methods)
    return proxy(entity, "inst", fields, methods)
end

local resolve_prefab

return {
    operations = operations,
    createEntity = create_entity,
    setPrefabResolver = function(resolve)
        resolve_prefab = resolve
    end,
    -- The global SpawnPrefab: the child's constructor records first, then the spawn names it at the call site.
    spawnPrefab = function(name)
        local child = resolve_prefab(name)
        record(0, "global", "call", "SpawnPrefab", name, child)
        return child
    end,
    entityId = function(entity)
        return assert(proxies[entity], "constructor did not return a recorded entity").entity
    end,
}
