Config = {}

-- The bot token goes in server.cfg, never in this file:
--   set fivecord_token "your-bot-token"

-- Your Discord server id (right click the server icon > Copy Server ID).
Config.guild = ''

-- Shown in embeds, the bot status and the connecting screen.
Config.serverName = 'My Server'

-- Where people go to appeal a ban. Shown to banned players. '' to hide.
Config.appeal = ''

-- ------------------------------------------------------------------ staff

-- Staff levels, lowest first. A member gets the highest level they have a role for.
Config.tiers = {
    { name = 'support', roles = { '' } },
    { name = 'mod', roles = { '' } },
    { name = 'admin', roles = { '' } },
    { name = 'owner', roles = { '' } },
}

-- Lowest level that can use a command. Anything left out uses the default
-- shown in /help. Example: lock /ban to admins only.
Config.permissions = {
    -- ban = 'admin',
    -- money = 'owner',
}

-- ---------------------------------------------------------------- channels

-- Channel ids. Leave '' to turn that feature off.
Config.channels = {
    staffChat = '',     -- two-way chat with staff in game
    reports = '',       -- a text or forum channel; each /report gets its own thread
}

-- Log channels. Anything without its own channel goes to `default`.
Config.logs = {
    default = '',
    joins = '',         -- connect, join, leave
    staff = '',         -- every action taken through the bot
    bans = '',          -- bans, unbans, warnings
    deaths = '',
    chat = '',          -- in-game chat, batched every few seconds
    resources = '',     -- resources starting and stopping
}

-- Ping this role on reports and urgent logs, like a ban dodge. '' for nobody.
Config.alertRole = ''

-- -------------------------------------------------------------- connecting

Config.allowlist = {
    enabled = false,
    roles = { '' },     -- any one of these lets them in
}

-- Turn Discord roles into in-game permissions while the player is online.
-- Roles update straight away when they change in Discord.
Config.aces = {
    -- ['123456789012345678'] = 'group.admin',
    -- ['234567890123456789'] = 'group.mod',
}

-- ------------------------------------------------------------------ in game

Config.commands = {
    report = 'report',        -- players: /report <message>
    staffChat = 'sc',         -- staff: /sc <message>
    reportCooldown = 60,      -- seconds between new reports
}

-- Saved places for /teleport. Coords are vec3-like tables.
Config.locations = {
    ['Legion Square'] = { x = 195.17, y = -933.77, z = 30.69 },
    ['Pillbox Hospital'] = { x = 298.67, y = -584.48, z = 43.26 },
    ['Mission Row PD'] = { x = 428.23, y = -984.28, z = 29.71 },
    ['Sandy Shores'] = { x = 1853.8, y = 3686.1, z = 34.27 },
    ['Paleto Bay'] = { x = -136.65, y = 6357.9, z = 31.49 },
}

-- --------------------------------------------------------------- the server

-- Bot status, rotating. {players} {max} {server} {queue}
Config.presence = {
    '{players}/{max} players',
    '{server}',
}

-- A voice channel whose name shows the player count. '' to turn off.
-- Discord only allows renaming a channel twice every 10 minutes.
Config.countChannel = ''
Config.countFormat = 'Players: {players}/{max}'

-- Daily restarts in server time, plus warnings before each one (minutes).
-- The command runs once everyone has been kicked. txAdmin brings the server back up.
Config.restarts = {
    times = { },           -- { '06:00', '18:00' }
    warnings = { 30, 15, 10, 5, 1 },
    command = 'quit "Scheduled restart"',
}

-- Console commands used by /server weather and /server time.
Config.weatherCommand = 'weather {type}'
Config.timeCommand = 'time {hour} {minute}'
Config.weatherTypes = {
    'EXTRASUNNY', 'CLEAR', 'CLOUDS', 'OVERCAST', 'RAIN', 'THUNDER',
    'CLEARING', 'FOGGY', 'SMOG', 'SNOW', 'BLIZZARD', 'XMAS', 'HALLOWEEN',
}

-- ----------------------------------------------------------- framework hooks

-- These run on the server. The defaults cover Qbox, QBCore and ESX.
-- Change them if you use a different medical or inventory resource.

Config.revive = function(source, framework)
    if GetResourceState('qbx_medical') == 'started' then
        return exports.qbx_medical:Revive(source)
    elseif framework == 'qb' then
        return TriggerClientEvent('hospital:client:Revive', source)
    elseif framework == 'esx' then
        return TriggerClientEvent('esx_ambulancejob:revive', source)
    end
    TriggerClientEvent('fivecord:revive', source)
end

Config.heal = function(source, framework)
    if GetResourceState('qbx_medical') == 'started' then
        return exports.qbx_medical:Heal(source)
    elseif framework == 'qb' then
        return TriggerClientEvent('hospital:client:Revive', source)
    end
    TriggerClientEvent('fivecord:heal', source)
end
