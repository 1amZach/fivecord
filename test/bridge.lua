-- lua5.4 test/bridge.lua
-- Runs server/bridge.lua against fake Qbox, QBCore and ESX.

local passed, failed = 0, 0
local function check(name, cond)
    if cond then passed = passed + 1 else failed = failed + 1; print('FAIL ' .. name) end
end

local function load(framework)
    local states = { fivecord = 'started' }
    local handler, results = nil, {}
    local events = {}

    _G.Config = { revive = function(src, fw) events[#events + 1] = ('revive %s %s'):format(src, fw) end, heal = function() end, serverName = 'x' }
    _G.GetResourceState = function(name) return states[name] or 'missing' end
    _G.GetCurrentResourceName = function() return 'fivecord' end
    _G.GetInvokingResource = function() return 'fivecord' end
    _G.CreateThread = function(fn) fn() end
    _G.AddEventHandler = function(_, fn) handler = fn end
    _G.TriggerEvent = function(_, id, ok, a, b) results[id] = { ok = ok, a = a, b = b } end
    _G.TriggerClientEvent = function(name, src) events[#events + 1] = name .. ' ' .. src end

    local qbPlayer = {
        PlayerData = {
            citizenid = 'ABC123',
            charinfo = { firstname = 'John', lastname = 'Doe' },
            job = { name = 'police', label = 'Police', grade = { level = 2, name = 'Sergeant' } },
            gang = { name = 'none', label = 'None' },
            money = { cash = 100, bank = 5000 },
        },
        Functions = {},
    }
    function qbPlayer.Functions.SetJob(job, grade) return job == 'police' and grade == '1' end
    function qbPlayer.Functions.AddMoney(acc, amt) qbPlayer.PlayerData.money[acc] = qbPlayer.PlayerData.money[acc] + amt return true end
    function qbPlayer.Functions.AddItem() return true end

    local xPlayer = {
        identifier = 'char1:abc',
        job = { name = 'mechanic', label = 'Mechanic', grade = 0, grade_label = 'Trainee' },
        accounts = { money = 50, bank = 900 },
        getName = function() return 'Jane Roe' end,
        getAccounts = function() return { { name = 'money', money = 50 }, { name = 'bank', money = 900 } } end,
    }
    function xPlayer.getAccount(name) local m = xPlayer.accounts[name] return m and { money = m } end
    function xPlayer.addAccountMoney(name, amt) xPlayer.accounts[name] = xPlayer.accounts[name] + amt end
    function xPlayer.setJob(job, grade) xPlayer.job.name = job end
    function xPlayer.canCarryItem() return false end

    local qbx = {}
    function qbx:GetPlayer() return qbPlayer end
    function qbx:GetJobs() return { police = { label = 'Police', grades = { [0] = { name = 'Recruit' }, [1] = { name = 'Officer' } } } } end
    function qbx:GetGangs() return {} end
    function qbx:SetJob(src, job, grade) return job == 'police', nil end
    function qbx:AddMoney(src, acc, amt) return true end
    function qbx:GetMoney(src, acc) return 1234 end

    local qbCore = { Functions = { GetPlayer = function() return qbPlayer end }, Shared = {
        Jobs = { police = { label = 'Police', grades = { ['0'] = { name = 'Recruit' }, ['1'] = { name = 'Officer' } } } },
        Items = { water = { label = 'Water' }, bread = { label = 'Bread' } },
        Gangs = {},
    } }
    local esx = {
        GetPlayerFromId = function() return xPlayer end,
        GetJobs = function() return { mechanic = { label = 'Mechanic', grades = { ['0'] = { grade = 0, name = 'trainee', label = 'Trainee' } } } } end,
        DoesJobExist = function(job) return job == 'mechanic' end,
        Items = { phone = { label = 'Phone' } },
    }

    _G.exports = setmetatable({}, { __index = function(_, res)
        if res == 'qbx_core' then return qbx end
        if res == 'qb-core' then return { GetCoreObject = function() return qbCore end } end
        if res == 'es_extended' then return { getSharedObject = function() return esx end } end
        if res == 'qbx_medical' then return { Revive = function(_, src) events[#events + 1] = 'qbx_medical ' .. src end } end
        return {}
    end })

    if framework == 'qbx' then states.qbx_core = 'started'; states.qbx_medical = 'started'; states.ox_inventory = 'missing' end
    if framework == 'qb' then states['qb-core'] = 'started' end
    if framework == 'esx' then states.es_extended = 'started' end

    dofile('server/bridge.lua')

    local n = 0
    local function call(name, ...)
        n = n + 1
        handler(n, name, { ... })
        local r = results[n]
        return r.ok, r.a, r.b
    end
    return call, events, xPlayer
end

-- QBCore
do
    local call, events = load('qb')
    local ok, fw = call('framework'); check('qb detected', ok and fw == 'qb')
    local _, char = call('character', 1)
    check('qb character name', char.name == 'John Doe')
    check('qb character job', char.jobLabel == 'Police' and char.grade == 2 and char.gradeLabel == 'Sergeant')
    check('qb money passed through', char.money.bank == 5000)
    local _, jobs = call('jobs')
    check('qb jobs', jobs[1].name == 'police' and jobs[1].grades[1].level == 0 and jobs[1].grades[2].label == 'Officer')
    local _, items = call('items')
    check('qb items sorted', items[1].name == 'bread' and items[2].label == 'Water')
    local _, set = call('setJob', 1, 'police', 1); check('qb setJob passes grade as string', set == true)
    local _, added, bal = call('money', 1, 'bank', 'add', 250); check('qb money add', added and bal == 5250)
    call('revive', 4); check('revive hook gets framework', events[#events] == 'revive 4 qb')
    local okBad, err = call('nothing'); check('unknown bridge fn reports error', okBad == false and err:find('no bridge function'))
    local _, cfg = call('config'); check('config strips functions', cfg.revive == nil and cfg.serverName == 'x')
end

-- Qbox
do
    local call = load('qbx')
    local _, fw = call('framework'); check('qbx detected', fw == 'qbx')
    local _, jobs = call('jobs'); check('qbx jobs with numeric grades', jobs[1].grades[2].label == 'Officer')
    local _, ok, bal = call('money', 1, 'bank', 'add', 10); check('qbx money via exports', ok == true and bal == 1234)
    local _, set = call('setJob', 1, 'police', 0); check('qbx setJob', set == true)
end

-- ESX
do
    local call, _, xPlayer = load('esx')
    local _, fw = call('framework'); check('esx detected', fw == 'esx')
    local _, char = call('character', 1)
    check('esx character', char.name == 'Jane Roe' and char.job == 'mechanic' and char.money.bank == 900)
    local _, jobs = call('jobs'); check('esx grade label preferred', jobs[1].grades[1].label == 'Trainee')
    local _, ok, bal = call('money', 1, 'cash', 'add', 25); check('esx cash maps to money', ok and bal == 75)
    local _, bad = call('setJob', 1, 'pilot', 0); check('esx unknown job refused', bad == false)
    local _, give, why = call('giveItem', 1, 'phone', 1); check('esx carry check', give == false and why == 'cannot carry that')
    local _, items = call('items'); check('esx items', items[1].name == 'phone')
end

print(('%d passed, %d failed'):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
