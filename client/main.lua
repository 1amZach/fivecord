local function chat(color, author, text)
    TriggerEvent('chat:addMessage', { color = color, multiline = true, args = { author, text } })
end

local function bigMessage(title, text, duration)
    local sf = RequestScaleformMovie('mp_big_message_freemode')
    local timeout = GetGameTimer() + 3000
    while not HasScaleformMovieLoaded(sf) do
        if GetGameTimer() > timeout then return end
        Wait(0)
    end

    BeginScaleformMovieMethod(sf, 'SHOW_SHARD_WASTED_MP_MESSAGE')
    ScaleformMovieMethodAddParamTextureNameString(title)
    ScaleformMovieMethodAddParamTextureNameString(text)
    EndScaleformMovieMethod()

    local untilTime = GetGameTimer() + duration
    while GetGameTimer() < untilTime do
        DrawScaleformMovieFullscreen(sf, 255, 255, 255, 255, 0)
        Wait(0)
    end

    SetScaleformMovieAsNoLongerNeeded(sf)
end

RegisterNetEvent('fivecord:announce', function(title, text)
    PlaySoundFrontend(-1, 'CHECKPOINT_PERFECT', 'HUD_MINI_GAME_SOUNDSET', true)
    chat({ 156, 44, 241 }, title, text)
    bigMessage(title, #text > 90 and text:sub(1, 87) .. '...' or text, 8000)
end)

RegisterNetEvent('fivecord:message', function(header, text)
    PlaySoundFrontend(-1, 'Text_Arrive_Tone', 'Phone_SoundSet_Default', true)
    lib.alertDialog({ header = header, content = text, centered = true })
end)

RegisterNetEvent('fivecord:notify', function(data)
    lib.notify(data)
end)

RegisterNetEvent('fivecord:staffChat', function(author, text)
    chat({ 43, 217, 204 }, ('[Staff] %s'):format(author), text)
end)

RegisterNetEvent('fivecord:reportReply', function(author, text)
    chat({ 245, 165, 36 }, ('[Report] %s'):format(author), text)
    lib.notify({ title = ('Reply from %s'):format(author), description = text, type = 'inform', duration = 8000 })
end)

-- --------------------------------------------------------------- actions

RegisterNetEvent('fivecord:freeze', function(state)
    local ped = cache.ped
    FreezeEntityPosition(ped, state)
    if cache.vehicle then FreezeEntityPosition(cache.vehicle, state) end
    lib.notify({
        title = state and 'You have been frozen by staff' or 'You can move again',
        type = state and 'warning' or 'success',
    })
end)

RegisterNetEvent('fivecord:teleport', function(x, y, z)
    local entity = cache.vehicle and cache.seat == -1 and cache.vehicle or cache.ped

    DoScreenFadeOut(250)
    while not IsScreenFadedOut() do Wait(0) end

    RequestCollisionAtCoord(x, y, z)
    SetEntityCoords(entity, x, y, z, false, false, false, false)

    -- find the ground if we were sent somewhere without a good height
    local timeout = GetGameTimer() + 2000
    while not HasCollisionLoadedAroundEntity(entity) and GetGameTimer() < timeout do Wait(0) end
    local found, ground = GetGroundZFor_3dCoord(x, y, z + 50.0, false)
    if found and math.abs(ground - z) > 2.0 then SetEntityCoords(entity, x, y, ground, false, false, false, false) end

    DoScreenFadeIn(250)
end)

RegisterNetEvent('fivecord:revive', function()
    local ped = cache.ped
    local coords = GetEntityCoords(ped)
    NetworkResurrectLocalPlayer(coords.x, coords.y, coords.z, GetEntityHeading(ped), 0, false)
    ClearPedBloodDamage(ped)
    SetEntityHealth(cache.ped, GetEntityMaxHealth(cache.ped))
end)

RegisterNetEvent('fivecord:heal', function()
    SetEntityHealth(cache.ped, GetEntityMaxHealth(cache.ped))
    ClearPedBloodDamage(cache.ped)
end)

RegisterNetEvent('fivecord:kill', function()
    SetEntityHealth(cache.ped, 0)
end)

-- ---------------------------------------------------------------- deaths

local dead = false

AddEventHandler('gameEventTriggered', function(name, args)
    if name ~= 'CEventNetworkEntityDamage' then return end

    local victim, attacker, weapon = args[1], args[2], args[7]
    if victim ~= cache.ped or dead or not IsEntityDead(victim) then return end

    dead = true
    local killer = 0
    if attacker and attacker ~= victim and IsEntityAPed(attacker) and IsPedAPlayer(attacker) then
        killer = GetPlayerServerId(NetworkGetPlayerIndexFromPed(attacker))
    end

    TriggerServerEvent('fivecord:died', killer, weapon)

    CreateThread(function()
        while IsEntityDead(cache.ped) do Wait(500) end
        dead = false
    end)
end)
