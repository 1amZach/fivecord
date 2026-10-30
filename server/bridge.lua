-- Everything framework specific lives here. The bot calls these through
-- `fivecord:bridge` so they can yield, and gets the answer back on
-- `fivecord:bridge:done`.

local Bridge = {}
local framework, core

local function started(name) return GetResourceState(name) == 'started' end

local function detect()
    if framework and framework ~= 'none' then return framework end

    if started('qbx_core') then
        framework = 'qbx'
    elseif started('qb-core') then
        framework, core = 'qb', exports['qb-core']:GetCoreObject()
    elseif started('es_extended') then
        framework, core = 'esx', exports.es_extended:getSharedObject()
    else
        framework = 'none'
    end

    return framework
end

local function strip(value)
    if type(value) == 'function' then return nil end
    if type(value) ~= 'table' then return value end
    local out = {}
    for k, v in pairs(value) do out[k] = strip(v) end
    return out
end

local function qbPlayer(src)
    if detect() == 'qbx' then return exports.qbx_core:GetPlayer(src) end
    return core.Functions.GetPlayer(src)
end

-- --------------------------------------------------------------- reading

function Bridge.config()
    return strip(Config)
end

function Bridge.framework()
    return detect()
end

function Bridge.character(src)
    local fw = detect()

    if fw == 'qbx' or fw == 'qb' then
        local player = qbPlayer(src)
        if not player then return nil end
        local pd = player.PlayerData
        return {
            id = pd.citizenid,
            name = ('%s %s'):format(pd.charinfo.firstname, pd.charinfo.lastname),
            job = pd.job.name,
            jobLabel = pd.job.label,
            grade = pd.job.grade.level,
            gradeLabel = pd.job.grade.name,
            gang = pd.gang and pd.gang.name,
            gangLabel = pd.gang and pd.gang.label,
            money = pd.money,
        }
    end

    if fw == 'esx' then
        local x = core.GetPlayerFromId(src)
        if not x then return nil end
        local money = {}
        for _, account in ipairs(x.getAccounts()) do money[account.name] = account.money end
        return {
            id = x.identifier,
            name = x.getName(),
            job = x.job.name,
            jobLabel = x.job.label,
            grade = x.job.grade,
            gradeLabel = x.job.grade_label,
            money = money,
        }
    end
end

local function groups(list)
    local out = {}
    for name, g in pairs(list or {}) do
        local grades = {}
        for level, grade in pairs(g.grades or {}) do
            grades[#grades + 1] = { level = tonumber(grade.grade or level), label = grade.label or grade.name }
        end
        table.sort(grades, function(a, b) return a.level < b.level end)
        out[#out + 1] = { name = name, label = g.label or name, grades = grades }
    end
    table.sort(out, function(a, b) return a.name < b.name end)
    return out
end

function Bridge.jobs()
    local fw = detect()
    if fw == 'qbx' then return groups(exports.qbx_core:GetJobs()) end
    if fw == 'qb' then return groups(core.Shared.Jobs) end
    if fw == 'esx' then return groups(core.GetJobs and core.GetJobs()) end
    return {}
end

function Bridge.gangs()
    local fw = detect()
    if fw == 'qbx' then return groups(exports.qbx_core:GetGangs()) end
    if fw == 'qb' then return groups(core.Shared.Gangs) end
    return {}
end

function Bridge.items()
    local list
    if started('ox_inventory') then
        list = exports.ox_inventory:Items()
    elseif detect() == 'qb' then
        list = core.Shared.Items
    elseif detect() == 'esx' then
        list = core.Items
    end

    local out = {}
    for name, item in pairs(list or {}) do
        out[#out + 1] = { name = name, label = item.label or name }
    end
    table.sort(out, function(a, b) return a.name < b.name end)
    return out
end

-- -------------------------------------------------------------- changing

function Bridge.setJob(src, job, grade)
    local fw = detect()

    if fw == 'qbx' then return exports.qbx_core:SetJob(src, job, grade) end

    if fw == 'qb' then
        local player = qbPlayer(src)
        return player ~= nil and player.Functions.SetJob(job, tostring(grade)) or false
    end

    if fw == 'esx' then
        local x = core.GetPlayerFromId(src)
        if not x or not core.DoesJobExist(job, grade) then return false end
        x.setJob(job, grade)
        return true
    end

    return false
end

function Bridge.setGang(src, gang, grade)
    local fw = detect()
    if fw == 'qbx' then return exports.qbx_core:SetGang(src, gang, grade) end
    if fw == 'qb' then
        local player = qbPlayer(src)
        return player ~= nil and player.Functions.SetGang(gang, tostring(grade)) or false
    end
    return false
end

local verbs = {
    qb = { add = 'AddMoney', remove = 'RemoveMoney', set = 'SetMoney' },
    esx = { add = 'addAccountMoney', remove = 'removeAccountMoney', set = 'setAccountMoney' },
}

function Bridge.money(src, account, action, amount)
    local fw = detect()
    local reason = 'fivecord'

    if fw == 'qbx' then
        local qbx = exports.qbx_core
        local ok = qbx[verbs.qb[action]](qbx, src, account, amount, reason)
        return ok, exports.qbx_core:GetMoney(src, account)
    end

    if fw == 'qb' then
        local player = qbPlayer(src)
        if not player then return false end
        local ok = player.Functions[verbs.qb[action]](account, amount, reason)
        return ok, player.PlayerData.money[account]
    end

    if fw == 'esx' then
        local x = core.GetPlayerFromId(src)
        if account == 'cash' then account = 'money' end
        if not x or not x.getAccount(account) then return false end
        x[verbs.esx[action]](account, amount, reason)
        return true, x.getAccount(account).money
    end

    return false
end

function Bridge.giveItem(src, item, count)
    if started('ox_inventory') then
        if not exports.ox_inventory:CanCarryItem(src, item, count) then return false, 'cannot carry that' end
        return exports.ox_inventory:AddItem(src, item, count)
    end

    local fw = detect()

    if fw == 'qb' then
        local player = qbPlayer(src)
        if not player or not core.Shared.Items[item] then return false, 'unknown item' end
        return player.Functions.AddItem(item, count)
    end

    if fw == 'esx' then
        local x = core.GetPlayerFromId(src)
        if not x then return false end
        if not x.canCarryItem(item, count) then return false, 'cannot carry that' end
        x.addInventoryItem(item, count)
        return true
    end

    return false, 'no inventory found'
end

function Bridge.revive(src)
    Config.revive(src, detect())
    return true
end

function Bridge.heal(src)
    Config.heal(src, detect())
    return true
end

-- ------------------------------------------------------------- dispatch

AddEventHandler('fivecord:bridge', function(id, name, args)
    if GetInvokingResource() ~= GetCurrentResourceName() then return end

    CreateThread(function()
        local fn = Bridge[name]
        if not fn then
            return TriggerEvent('fivecord:bridge:done', id, false, ('no bridge function %s'):format(name))
        end

        local ok, a, b = pcall(fn, table.unpack(args or {}))
        TriggerEvent('fivecord:bridge:done', id, ok, a, b)
    end)
end)
