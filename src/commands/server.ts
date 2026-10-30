import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as bans from '../bans';
import * as bridge from '../bridge';
import { config } from '../config';
import { lock } from '../connect';
import { db } from '../db';
import { maxPlayers, online, resources } from '../fivem';
import { audit } from '../logs';
import * as reports from '../reports';
import * as restarts from '../restarts';
import * as sessions from '../sessions';
import { colors, done, embed, fail, footer } from '../ui';
import { clip, fill, formatDuration, ts } from '../util';
import type { Command } from './types';

async function status() {
    const players = online();
    const all = resources();
    const running = all.filter((r) => r.state === 'started').length;
    const next = restarts.upcoming();
    const fw = await bridge.framework().catch(() => 'none');
    const avgPing = players.length ? Math.round(players.reduce((n, p) => n + p.ping, 0) / players.length) : 0;

    return footer(embed(lock.on ? colors.amber : colors.brand))
        .setTitle(config.serverName)
        .setDescription(lock.on ? `**Locked**${lock.reason ? ` · ${lock.reason}` : ''}. Only staff can join.` : 'Open')
        .addFields(
            { name: 'Players', value: `**${players.length}** / ${maxPlayers()}\n${avgPing}ms average ping`, inline: true },
            { name: 'Uptime', value: formatDuration(process.uptime()), inline: true },
            { name: 'Next restart', value: next ? `${ts(next.at)}\n${clip(next.reason, 60)}` : 'None planned', inline: true },
            { name: 'Resources', value: `${running} running / ${all.length}`, inline: true },
            { name: 'Reports', value: `${reports.openCount()} open`, inline: true },
            { name: 'Bans', value: `${bans.list(true).length} active`, inline: true },
            {
                name: 'Server',
                value: [
                    `Framework \`${fw}\` · storage \`${db().kind}\``,
                    `OneSync \`${GetConvar('onesync', 'off')}\` · build \`${GetConvar('version', '?').match(/v\d+\.\d+\.\d+\.(\d+)/)?.[1] ?? '?'}\``,
                ].join('\n'),
            },
        );
}

export const server: Command = {
    category: 'Server',
    tier: 'admin',
    tiers: { status: 'support', weather: 'mod', time: 'mod' },
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Run the server')
        .addSubcommand((s) => s.setName('status').setDescription('Players, uptime, restarts and more'))
        .addSubcommand((s) =>
            s
                .setName('lock')
                .setDescription('Only let staff join, for maintenance')
                .addStringOption((o) => o.setName('reason').setDescription('Shown to players who try to join')),
        )
        .addSubcommand((s) => s.setName('unlock').setDescription('Let everyone join again'))
        .addSubcommand((s) =>
            s
                .setName('kickall')
                .setDescription('Kick everyone')
                .addStringOption((o) => o.setName('reason').setDescription('Shown to players').setRequired(true)),
        )
        .addSubcommand((s) =>
            s
                .setName('restart')
                .setDescription('Restart the server with countdown warnings in game')
                .addIntegerOption((o) => o.setName('minutes').setDescription('How long until it restarts').setRequired(true).setMinValue(0).setMaxValue(180))
                .addStringOption((o) => o.setName('reason').setDescription('Shown in game')),
        )
        .addSubcommand((s) => s.setName('cancelrestart').setDescription('Cancel the next restart'))
        .addSubcommand((s) =>
            s
                .setName('weather')
                .setDescription('Change the weather')
                .addStringOption((o) => o.setName('type').setDescription('Weather').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
            s
                .setName('time')
                .setDescription('Change the time of day')
                .addIntegerOption((o) => o.setName('hour').setDescription('0 to 23').setRequired(true).setMinValue(0).setMaxValue(23))
                .addIntegerOption((o) => o.setName('minute').setDescription('0 to 59').setMinValue(0).setMaxValue(59)),
        ),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const sub = i.options.getSubcommand();

        switch (sub) {
            case 'status':
                return i.reply({ embeds: [await status()], flags: MessageFlags.Ephemeral });

            case 'lock': {
                lock.on = true;
                lock.reason = i.options.getString('reason') ?? '';
                audit(i.user, 'Locked the server', undefined, lock.reason, colors.amber);
                return done(i, 'Server locked. Only staff can join until you `/server unlock`.');
            }

            case 'unlock':
                lock.on = false;
                lock.reason = '';
                audit(i.user, 'Unlocked the server');
                return done(i, 'Server unlocked.');

            case 'kickall': {
                const reason = i.options.getString('reason', true);
                const list = online();
                await sessions.countAll();
                for (const p of list) DropPlayer(p.src, reason);
                audit(i.user, 'Kicked everyone', `${list.length} players`, reason, colors.red);
                return done(i, `Kicked ${list.length} player${list.length === 1 ? '' : 's'}.`);
            }

            case 'restart': {
                const minutes = i.options.getInteger('minutes', true);
                const reason = i.options.getString('reason') ?? '';
                const p = restarts.schedule(minutes, reason, i.user.username);
                audit(i.user, 'Scheduled a restart', undefined, `${ts(p.at)} ${reason}`, colors.amber);
                return done(i, `Restarting ${minutes ? ts(p.at) : 'now'}. Players get warned in game.`);
            }

            case 'cancelrestart': {
                const was = restarts.cancel();
                if (!was) return fail(i, 'No restart is planned.');
                audit(i.user, 'Cancelled a restart', undefined, ts(was.at));
                return done(i, `Cancelled the restart planned for ${ts(was.at)}.`);
            }

            case 'weather': {
                const type = i.options.getString('type', true).toUpperCase();
                ExecuteCommand(fill(config.weatherCommand, { type, weather: type }));
                audit(i.user, 'Changed the weather', undefined, type);
                return done(i, `Weather set to **${type.toLowerCase()}**.`);
            }

            case 'time': {
                const hour = i.options.getInteger('hour', true);
                const minute = i.options.getInteger('minute') ?? 0;
                ExecuteCommand(fill(config.timeCommand, { hour, minute }));
                const shown = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                audit(i.user, 'Changed the time', undefined, shown);
                return done(i, `Time set to **${shown}**.`);
            }
        }
    },
    async autocomplete(i) {
        const q = i.options.getFocused().toUpperCase();
        await i.respond(
            config.weatherTypes
                .filter((w) => w.includes(q))
                .slice(0, 25)
                .map((w) => ({ name: w.toLowerCase(), value: w })),
        );
    },
};

export const announce: Command = {
    category: 'Server',
    tier: 'mod',
    summary: 'Big banner on everyone\'s screen, plus a chat message',
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Announce something to everyone in game')
        .addStringOption((o) => o.setName('message').setDescription('What to say').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('title').setDescription('Defaults to Announcement').setMaxLength(40)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const text = i.options.getString('message', true);
        restarts.announce(i.options.getString('title') ?? 'Announcement', text);
        audit(i.user, 'Announced', undefined, text);
        await done(i, `Announced to ${online().length} players.`);
    },
};

export const top: Command = {
    category: 'General',
    tier: null,
    summary: 'Playtime leaderboard',
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('Who has played the most')
        .addIntegerOption((o) => o.setName('count').setDescription('How many, up to 25').setMinValue(3).setMaxValue(25)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        await sessions.countAll();
        const list = await db().top(i.options.getInteger('count') ?? 10);
        const medal = (n: number) => ['🥇', '🥈', '🥉'][n] ?? `\`${String(n + 1).padStart(2)}\``;
        const live = new Set(online().map((p) => p.license));

        await i.reply({
            embeds: [
                footer(embed())
                    .setTitle('Most time played')
                    .setDescription(
                        list.length
                            ? list.map((p, n) => `${medal(n)} **${p.name}** · ${formatDuration(p.playtime)}${live.has(p.license) ? ' · online' : ''}`).join('\n')
                            : 'Nobody has played yet.',
                    ),
            ],
        });
    },
};

