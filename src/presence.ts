import { ActivityType, ChannelType } from 'discord.js';
import { config } from './config';
import { client } from './discord';
import { maxPlayers, online } from './fivem';
import { fill } from './util';

const values = () => ({
    players: online().length,
    max: maxPlayers(),
    server: config.serverName,
    queue: GetConvarInt('fivecord_queue', 0),
});

let turn = 0;

function rotate() {
    if (!client.user || !config.presence.length) return;
    const text = fill(config.presence[turn++ % config.presence.length]!, values());
    client.user.setPresence({ activities: [{ name: text, state: text, type: ActivityType.Custom }] });
}

let lastName = '';

async function rename() {
    if (!config.countChannel) return;
    const name = fill(config.countFormat, values());
    if (name === lastName) return;

    const channel = await client.channels.fetch(config.countChannel).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;
    await channel.setName(name).then(() => (lastName = name)).catch(() => {});
}

export function startPresence() {
    rotate();
    void rename();
    setInterval(rotate, 30_000);
    // Discord allows two renames per channel every ten minutes
    setInterval(() => void rename(), 600_000);
}
