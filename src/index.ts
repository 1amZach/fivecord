import { Events } from 'discord.js';
import * as aces from './aces';
import { loadBans } from './bans';
import { call } from './bridge';
import { deploy, handle } from './commands';
import { normalize, setConfig, config } from './config';
import './connect';
import { openStore } from './db';
import { client, guild } from './discord';
import { registerApi } from './api';
import { registerExports } from './exports';
import { online, resource } from './fivem';
import * as game from './game';
import { flushChat } from './logs';
import { startPresence } from './presence';
import * as news from './news';
import * as reports from './reports';
import { startClock } from './restarts';
import * as sessions from './sessions';

let ready = false;

on('playerJoining', () => {
    if (!ready) return;
    const src = Number(source);
    sessions.joined(sessions.start(src));
    game.suggestions(src);
});

on('playerDropped', (reason: string) => {
    if (!ready) return;
    const src = Number(source);
    void sessions.end(src, reason);
    void reports.playerLeft(src);
});

on('onResourceStop', (name: string) => {
    if (name !== resource) return;
    void sessions.countAll();
    flushChat();
    void client.destroy();
});

client.once(Events.ClientReady, async (c) => {
    const g = guild();
    if (!g) {
        console.error(`fivecord: the bot isn't in the server set in Config.guild (${config.guild || 'empty'}). Invite it, then restart fivecord.`);
        return;
    }

    try {
        await g.members.fetch();
    } catch {
        console.error('fivecord: could not load members. Turn on the Server Members intent in the Discord developer portal.');
    }

    await deploy(g).catch((err) => console.error('fivecord: could not register slash commands:', err.message));
    startPresence();
    void news.loadNews();

    // members cache is filled now, give online players their roles
    for (const s of sessions.sessions.values()) aces.sync(s.src, [...(g.members.cache.get(s.discord ?? '')?.roles.cache.keys() ?? [])]);

    console.log(`fivecord: logged in as ${c.user.tag} in ${g.name}`);
});

client.on(Events.InteractionCreate, (i) => void handle(i));

client.on(Events.MessageCreate, (m) => {
    void game.staffMessage(m);
    void reports.relay(m);
    news.onMessage(m);
});

client.on(Events.GuildMemberUpdate, (before, after) => {
    if (after.guild.id !== config.guild) return;
    if (before.roles.cache.size === after.roles.cache.size && before.roles.cache.every((_, id) => after.roles.cache.has(id))) return;

    const roles = [...after.roles.cache.keys()];
    for (const s of sessions.byDiscord(after.id)) {
        aces.sync(s.src, roles);
        const added = roles.filter((r) => !before.roles.cache.has(r));
        const removed = [...before.roles.cache.keys()].filter((r) => !after.roles.cache.has(r));
        emit('fivecord:rolesChanged', s.src, added, removed);
        emit('discordbridge:rolesChanged', s.src, added, removed);
    }
});

client.on(Events.Error, (err) => console.error('fivecord: discord error:', err.message));

async function boot() {
    const [raw] = await call('config');
    setConfig(normalize(raw));

    const store = await openStore();
    await loadBans();
    registerExports();
    registerApi();

    // after a restart of this resource, pick up whoever is already playing
    for (const p of online()) sessions.start(p.src);
    ready = true;

    game.registerCommands();
    game.suggestions(-1);
    startClock();
    setInterval(() => void sessions.countAll(), 300_000);

    console.log(`fivecord: storing data in ${store.kind === 'mysql' ? 'MySQL' : 'data.json'}`);

    const token = GetConvar('fivecord_token', '');
    if (!token) {
        console.error('fivecord: no bot token. Add  set fivecord_token "your-token"  to server.cfg and restart fivecord.');
        return;
    }
    if (!config.guild) console.error('fivecord: Config.guild is empty, set it to your Discord server id.');

    await client.login(token).catch((err) => console.error(`fivecord: could not log in to Discord: ${err.message}`));
}

setTimeout(() => {
    boot().catch((err) => console.error('fivecord: failed to start:', err));
}, 0);
