# fivecord

Run your FiveM server from Discord. Look players up, warn, kick and ban them, answer their reports, change jobs and money, restart resources and the whole server, all with slash commands. It runs inside your FiveM server as a normal resource, so there's no separate bot to host.

Works with Qbox, QBCore and ESX, or with no framework at all.

## Features

- **Player lookup** for anyone who has ever joined, online or not: playtime, first and last seen, character, job, money, vehicles, warnings, bans and staff notes, with buttons to act on them right there. Also on Discord's right-click menu: Apps › Look up in FiveM.
- **Bans that stick.** Online or offline, timed or permanent. A ban covers the player's identifiers and hardware tokens, so a fresh account on the same PC is still banned, and staff get pinged when someone tries. Banned players see the reason, when it ends and where to appeal.
- **Reports.** `/report` in game opens a thread in Discord with Claim, Look up and Close buttons. Whatever staff write in the thread shows up in the player's chat.
- **Staff chat** between Discord and staff in game.
- **Warnings and notes** that stay on a player's record.
- **Moderation:** message, warn, kick, freeze, revive, heal, kill, teleport, screenshot, video clip, kick everyone.
- **Economy:** set job, set gang, give or take money, give items, with autocomplete for every job, grade and item.
- **Server control:** lock the server for maintenance, restart with countdown warnings in game, daily restarts, weather and time, announcements, start/stop/restart resources, and a console that shows you what the command printed.
- **Discord roles become in-game permissions** (aces) and update the moment a role changes, no reconnect.
- **Allowlist** by Discord role.
- **Logs** for joins and leaves, deaths, chat, resources, bans and every action taken through the bot, each to its own channel if you like.
- **Staff levels** (support, mod, admin, owner) mapped to your Discord roles. Every command has a sensible default you can change.
- **Autocomplete everywhere.** Start typing a name, an id or a Discord user.
- **Bot status** with the live player count, and an optional voice channel that shows it.
- **Exports** for your other resources, including the same names discordbridge uses.

## Requirements

- A recent FXServer build (fivecord runs on Node 22, which FXServer provides).
- [ox_lib](https://github.com/overextended/ox_lib)
- Optional: [oxmysql](https://github.com/overextended/oxmysql). Without it, data is kept in `data.json` inside the resource.
- Optional: [fivecapture](https://github.com/1amZach/fivecapture) for `/screenshot` and `/record`, or screenshot-basic for `/screenshot` only.

## Install

1. Create an application at the [Discord developer portal](https://discord.com/developers/applications) and add a bot to it.
2. On the **Bot** page, turn on **Server Members Intent** and **Message Content Intent**.
3. Invite the bot with this link, swapping in your application id:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=326417632320
   ```

   If you want the player count channel, also give the bot **Manage Channel** on that one voice channel.
4. Download `fivecord.zip` from the [releases](https://github.com/1amZach/fivecord/releases), put the `fivecord` folder in your resources, and add to `server.cfg`:

   ```
   set fivecord_token "your-bot-token"
   ensure ox_lib
   ensure oxmysql
   ensure fivecord
   ```

   Start fivecord after your framework, oxmysql and fivecapture or screenshot-basic.
5. Open `config.lua`, set `Config.guild` to your Discord server id and fill in the role ids for each staff level. Everything else is optional.

Discord members with the Administrator permission are treated as the top staff level, so you can use the bot straight away while you set roles up.

## Commands

Defaults are shown. Change any of them in `Config.permissions`:

```lua
Config.permissions = {
    ban = 'admin',            -- a whole command
    ['server status'] = 'mod' -- or one subcommand
}
```

**General**

| Command | What it does | Default |
|---|---|---|
| `/help` | Every command, who can use it, and where to get help | everyone |
| `/top` | Playtime leaderboard | everyone |

**Players**

| Command | What it does | Default |
|---|---|---|
| `/players` | Everyone online right now | support |
| `/lookup` | Everything about a player: account, character, money, vehicles, warnings, bans and notes | support |
| Apps › Look up in FiveM | Right click a Discord member | support |
| `/where` | Where a player is right now | support |
| `/revive` | Revive a player, or everyone | support |
| `/heal` | Heal a player to full | support |
| `/teleport` | Send a player to another player, a saved location or exact coords | mod |
| `/kill` | Kill a player | admin |

**Moderation**

| Command | What it does | Default |
|---|---|---|
| `/message` | Pop up a message on a player's screen | support |
| `/warn` | Warn a player. It goes on their record and pops up in game | support |
| `/warnings view` | Every warning on a player | support |
| `/warnings remove` | Remove one warning | mod |
| `/warnings clear` | Remove all of a player's warnings | admin |
| `/note add` | Add a staff note | support |
| `/note remove` | Remove a note | support |
| `/kick` | Kick a player from the server | mod |
| `/freeze` | Freeze or unfreeze a player | mod |
| `/screenshot` | See a player's screen right now | mod |
| `/record` | A short video of a player's screen, 3 to 30 seconds. Needs fivecapture | mod |
| `/ban` | Ban a player, online or offline | mod |
| `/unban` | Lift a ban | mod |
| `/bans` | Browse bans | support |

**Economy**

| Command | What it does | Default |
|---|---|---|
| `/setjob` | Change a player's job | admin |
| `/setgang` | Change a player's gang (Qbox and QBCore) | admin |
| `/money` | Give, take or set a player's money | admin |
| `/giveitem` | Put an item in a player's inventory | admin |

**Server**

| Command | What it does | Default |
|---|---|---|
| `/server status` | Players, uptime, restarts and more | support |
| `/server lock` | Only let staff join, for maintenance | admin |
| `/server unlock` | Let everyone join again | admin |
| `/server kickall` | Kick everyone | admin |
| `/server restart` | Restart with countdown warnings in game | admin |
| `/server cancelrestart` | Cancel the next restart | admin |
| `/server weather` | Change the weather | mod |
| `/server time` | Change the time of day | mod |
| `/announce` | Big banner on everyone's screen, plus a chat message | mod |
| `/resource list` | Every resource and whether it's running | support |
| `/resource start` | Start a resource | admin |
| `/resource stop` | Stop a resource | admin |
| `/resource restart` | Restart a resource | admin |
| `/resource refresh` | Pick up new and changed resources from disk | admin |
| `/console` | Run a server console command and see what it prints | owner |

Every reply is only visible to the person who ran the command, except `/top`.

### In game

| Command | Who | |
|---|---|---|
| `/report <message>` | everyone | Opens a report, or adds to your open one |
| `/sc <message>` | staff | Staff chat, shared with the Discord channel |

Both names can be changed in `Config.commands`.

## Restarts

Daily restarts go in `Config.restarts.times`, in server time. Players are warned in game at each of `Config.restarts.warnings` minutes. When the time comes everyone is kicked with a message and `Config.restarts.command` runs. The default is `quit`, which txAdmin treats as a crash and restarts the server. `/server restart` and `/server cancelrestart` work the same way for one-off restarts.

## Exports

```lua
local fivecord = exports.fivecord

fivecord:getDiscordId(source)            -- '123456789012345678' or nil
fivecord:getRoles(source)                -- { '123...', '456...' }
fivecord:hasRole(source, '123...')       -- or a list of role ids, true if any match
fivecord:getName(source)                 -- Discord display name
fivecord:getAvatar(source)
fivecord:getTier(source)                 -- 'admin', or nil for non-staff
fivecord:isStaff(source)

fivecord:log('bans', 'Title', 'Description', 0xE5484D)  -- to a log channel, optionally with an image data URI last
fivecord:send('channel id', 'plain message')
fivecord:announce('Title', 'Shown to everyone in game')
fivecord:getNews()                       -- latest post in Config.channels.news: { author, text, at }

-- for anticheats: seconds 0 = permanent, the last argument is who banned them
fivecord:ban(source, 'Noclip', 0, 'Anticheat')
fivecord:warn(source, 'Speeding in the city', 'Speed cameras')
fivecord:isBanned('license:...')
```

`isRolePresent`, `isMember`, `getMember` and `getRoleNames` exist too, so scripts written for discordbridge or zdiscord mostly work as they are.

Events you can listen to on the server:

```lua
AddEventHandler('fivecord:rolesChanged', function(source, added, removed) end)
AddEventHandler('fivecord:playerBanned', function(source, license, ban) end)
```

### API for other resources

Server-side resources can ask fivecord to do anything the slash commands do, on behalf of a staff member. It checks their staff level against the same permissions, and logs it under their name. This is what fivepanel uses.

```js
emit('fivecord:api', id, 'act', ['kick', '@12', 'AFK'], { id: discordId, name: 'Zach' });
on('fivecord:api:done', (id, ok, result) => {});
```

Actions: `access`, `players`, `search`, `profile`, `act` (message, warn, kick, freeze, revive, heal, kill, teleport, bring, screenshot, ban, note), `unban`, `removeEntry`, `bans`, `reports`, `report`, `status` and `server`. See `src/api.ts`.

## Frameworks

`server/bridge.lua` is where fivecord talks to Qbox, QBCore and ESX. Revive and heal are hooks in `config.lua`, so if you use a different medical resource you only change those two functions. Items go through ox_inventory when it's running.

## Building from source

The release zip already contains the built `dist/server.js`. To change the bot itself:

```
npm install
npm run build
npm test
```

The code is TypeScript in `src`, bundled with esbuild into one file.

## Addons

- [joinqueue](https://github.com/1amZach/joinqueue): a connection queue for full servers, with Discord role priority and crash grace.
- [warden](https://github.com/1amZach/warden): an anticheat. When it's running, its bans go through fivecord and show up in `/bans` and `/lookup`, its detections go to the `anticheat` log channel with a screenshot, and `/teleport` won't set it off.
- [fivecapture](https://github.com/1amZach/fivecapture): screenshots and video clips. Adds `/record` and a Record button on `/lookup`, and warden's clips are attached to its anticheat logs so they play in Discord.
- [fiveadmin](https://github.com/1amZach/fiveadmin): an in-game admin menu. Staff get the same levels as on Discord, and its warnings, kicks and bans go through fivecord.
- [fiveload](https://github.com/1amZach/fiveload): a loading screen. It shows how many staff are online and the latest post from `Config.channels.news`.
- [fivepanel](https://github.com/1amZach/fivepanel): a web admin panel. It uses fivecord's staff levels, and everything staff do in it goes through fivecord and shows up in your logs.

fivecord works the same with or without them.

## Support

Made by **IamZach**. Questions, bugs or ideas: [discord.gg/agn](https://discord.gg/agn)

Setup questions can also go in [Discussions](https://github.com/1amZach/fivecord/discussions), so the answers stay searchable for the next person.

## License

MIT
