local operations = {}
local proxies = {}
local task_callbacks, work_callbacks = {}, {}
local engine_callbacks = {}
local event_callbacks, periodic_callbacks, next_tasks = {}, {}, {}
local vector3
local next_entity = 0
local lunar_hail_workable = false

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
        if engine_callbacks[value] then
            return { kind = "engineCallback", name = engine_callbacks[value] }
        end
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
    lootdropper = { "SetLoot", "SetLootSetupFn", "SetChanceLootTable", "AddChanceLoot", "SpawnLootPrefab", "DropLoot" },
    locomotor = { "SetTriggersCreep" },
    lunarhailbuildup = { "SetTotalWorkAmount", "SetMoonGlassAmount" },
    inspectable = {},
    workable = { "SetWorkAction", "SetWorkLeft", "SetOnWorkCallback", "SetOnFinishCallback" },
    ghostgestalter = {},
    burnable = { "SetFXLevel", "SetBurnTime", "AddBurnFX", "SetOnIgniteFn", "SetOnExtinguishFn", "SetOnBurntFn" },
    propagator = { "SetOnFlashPoint" },
    hauntable = { "SetOnHauntFn" },
    -- componentutil.lua MakeRoseTarget_CreateFuel / _IncreasedHorror.
    roseinspectable = { "SetOnResidueActivated", "SetForcedInduceCooldownOnActivate" },
    sittable = {},
    savedrotation = {},
    health = { "SetMaxHealth", "SetInvincible", "Kill" },
    playerprox = { "SetDist", "SetOnPlayerNear", "SetOnPlayerFar", "SetPlayerAliveMode" },
    combat = { "SetOnHit" },
    teleporter = { "SetEnabled" },
    pickable = {},
    witherable = {},
    growable = { "SetStage", "StartGrowing", "StopGrowing" },
    simplemagicgrower = { "SetLastStage" },
    waxable = { "SetWaxfn", "SetNeedsSpray" },
}

local function create_entity()
    next_entity = next_entity + 1
    local entity = next_entity
    local components, tags = {}, {}
    -- inst.GUID: the recorded entity id, so a skin init_fn passing it can be matched to its entity.
    local fields = { components = components, GUID = entity }
    local methods = recorded_methods(entity, "inst", {
        "WatchWorldState", "SetDeploySmartRadius", "SetStateGraph", "ListenForEvent", "RemoveEventCallback", "Remove",
    })

    methods.ListenForEvent = function(_, name, callback, ...)
        record(entity, "inst", "call", "ListenForEvent", name, callback, ...)
        local listeners = event_callbacks[entity] or {}
        listeners[name] = callback
        event_callbacks[entity] = listeners
    end
    methods.DoPeriodicTask = function(_, period, callback, initialdelay)
        record(entity, "inst", "call", "DoPeriodicTask", period, callback, initialdelay)
        periodic_callbacks[entity] = callback
    end
    engine_callbacks[methods.Remove] = "inst.Remove"
    methods.DoTaskInTime = function(_, seconds, callback, ...)
        record(entity, "inst", "call", "DoTaskInTime", seconds, callback, ...)
        local tasks = task_callbacks[entity] or {}
        local at_time = tasks[seconds] or {}
        local task = { callback = callback, args = table.pack(...) }
        at_time[#at_time + 1] = task
        next_tasks[entity] = task
        tasks[seconds] = at_time
        task_callbacks[entity] = tasks
    end
    methods.GetPosition = function() return vector3(0, 0, 0) end
    methods.RemoveComponent = function(_, name)
        record(entity, "inst", "call", "RemoveComponent", name)
        components[name] = nil
    end
    methods.SetBrain = function(_, brain)
        -- The brain class is a Lua table with cycles. Its Lua entry is already loaded by the profile.
        assert(type(brain) == "table", "expected a brain class")
        record(entity, "inst", "call", "SetBrain")
    end
    methods.RemoveTag = function(_, tag)
        record(entity, "inst", "call", "RemoveTag", tag)
        tags[tag] = nil
    end
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
        local component_calls = recorded_methods(entity, target, names)
        if name == "workable" then
            local callbacks = {}
            work_callbacks[entity] = callbacks
            for _, setter in ipairs({ "SetOnWorkCallback", "SetOnFinishCallback" }) do
                component_calls[setter] = function(_, callback)
                    record(entity, target, "call", setter, callback)
                    callbacks[setter] = callback
                end
            end
        elseif name == "burnable" then
            component_calls.Extinguish = function() record(entity, target, "call", "Extinguish") end
        elseif name == "lunarhailbuildup" then
            component_calls.IsBuildupWorkable = function()
                return lunar_hail_workable
            end
        elseif name == "playerprox" then
            -- SetPlayerAliveMode(inst.components.playerprox.AliveModes.AliveOnly): the enum the constructor passes.
            component_calls.AliveModes = { AliveOnly = "AliveOnly" }
        end
        local component = components[name] or proxy(entity, target, {}, component_calls)
        components[name] = component
        return component
    end
    methods.SpawnChild = function(_, name)
        local child = create_entity()
        record(entity, "inst", "call", "SpawnChild", name, child)
        return child
    end

    local engine_methods = recorded_methods(entity, "entity", { "SetPristine", "SetParent", "SetAABB" })
    local engine_objects = {
        Transform = { "SetNoFaced", "SetFourFaced", "SetEightFaced" },
        AnimState = {
            "SetBank", "SetBuild", "PlayAnimation", "PushAnimation", "SetLightOverride",
            "ClearOverrideSymbol", "OverrideSymbol", "SetFinalOffset", "Hide",
            -- prefabskin.lua init_fns: basic_init_fn SetSkin, and the item skin symbols of a child.
            "SetSkin", "OverrideItemSkinSymbol", "Show", "SetRayTestOnBB",
        },
        MiniMapEntity = { "SetIcon", "SetCanUseCache", "SetDrawOverFogOfWar" },
        Light = { "Enable", "SetFalloff", "SetIntensity", "SetColour", "SetRadius" },
        Physics = { "SetMass", "SetCollisionGroup", "SetCollisionMask", "SetCapsule", "SetFriction", "SetDamping", "CollidesWith", "ClearCollisionMask" },
        SoundEmitter = { "PlaySound" },
        Network = {},
    }
    for name, names in pairs(engine_objects) do
        local method = "Add" .. name
        engine_methods[method] = function()
            record(entity, "entity", "call", method)
            local methods = recorded_methods(entity, name, names)
            if name == "Transform" then
                methods.GetWorldPosition = function() return 0, 0, 0 end
            elseif name == "Physics" then
                -- Obstacle profiles set mass to zero before their callbacks query it.
                local mass
                methods.SetMass = function(_, value)
                    record(entity, name, "call", "SetMass", value)
                    mass = value
                end
                methods.GetMass = function() return assert(mass, "no recorded mass") end
            end
            local object = proxy(entity, name, {}, methods)
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
    setVector3 = function(constructor)
        vector3 = constructor
    end,
    shakeAllCameras = function(...)
        record(0, "global", "call", "ShakeAllCameras", ...)
    end,
    playerRangeQuery = function(get_distance_sq)
        return function(x, y, z, rangesq)
            record(0, "global", "call", "IsAnyPlayerInRangeSq", x, y, z, rangesq)
            return get_distance_sq() < rangesq
        end
    end,
    runPeriodicTask = function(inst)
        assert(periodic_callbacks[proxies[inst].entity], "no periodic task")(inst)
    end,
    runNextTask = function(inst)
        local entity = proxies[inst].entity
        local task = assert(next_tasks[entity], "no new one-shot task")
        next_tasks[entity] = nil
        task.callback(inst, table.unpack(task.args, 1, task.args.n))
    end,
    sendEvent = function(inst, name, source, data)
        assert(event_callbacks[proxies[inst].entity][name], name)(source, data)
    end,
    runWorkCallback = function(inst, setter, worker)
        assert(work_callbacks[proxies[inst].entity][setter], setter)(inst, worker)
    end,
    runTask = function(inst, seconds)
        local tasks = task_callbacks[proxies[inst].entity][seconds]
        assert(tasks and #tasks == 1, "expected one task at delay " .. seconds)
        local task = tasks[1]
        task.callback(inst, table.unpack(task.args, 1, task.args.n))
    end,
    -- A value a callback the sandbox invoked returned, such as inspectable.getstatus's status.
    recordReturn = function(inst, target, name, value)
        record(proxies[inst].entity, target, "return", name, value)
    end,
    setLunarHailWorkable = function(value)
        lunar_hail_workable = value
    end,
    setSharedLootTable = function(name, loot)
        record(0, "global", "call", "SetSharedLootTable", name, loot)
    end,
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
