import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as act from '../actions';
import * as bridge from '../bridge';
import { config } from '../config';
import { coords, online } from '../fivem';
import { audit } from '../logs';
import { describe, needOnline, suggest } from '../targets';
import { done, fail } from '../ui';
import type { Command } from './types';

const reply = (i: Parameters<typeof done>[0], r: act.Result) => (r.ok ? done(i, r.text) : fail(i, r.text));

export const revive: Command = {
    category: 'Players',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('revive')
        .setDescription('Revive a player, or everyone')
        .addStringOption((o) => o.setName('player').setDescription('Leave empty with everyone:true').setAutocomplete(true))
        .addBooleanOption((o) => o.setName('everyone').setDescription('Revive the whole server')),
    async run(i) {
        if (!i.isChatInputCommand()) return;

        if (i.options.getBoolean('everyone')) {
            const list = online();
            await Promise.all(list.map((p) => bridge.revive(p.src).catch(() => {})));
            audit(i.user, 'Revived everyone', `${list.length} players`);
            return done(i, `Revived all ${list.length} players.`);
        }

        const raw = i.options.getString('player');
        if (!raw) return fail(i, 'Pick a player, or set `everyone` to true.');
        const t = await needOnline(i, raw);
        if (t) await reply(i, await act.revive(i.user, t));
    },
    autocomplete: (i) => suggest(i, false),
};

export const heal: Command = {
    category: 'Players',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('heal')
        .setDescription('Heal a player to full')
        .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (t) await reply(i, await act.heal(i.user, t));
    },
    autocomplete: (i) => suggest(i, false),
};

export const kill: Command = {
    category: 'Players',
    tier: 'admin',
    data: new SlashCommandBuilder()
        .setName('kill')
        .setDescription('Kill a player')
        .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (t) await reply(i, await act.kill(i.user, t));
    },
    autocomplete: (i) => suggest(i, false),
};

export const teleport: Command = {
    category: 'Players',
    tier: 'mod',
    summary: 'Send a player to another player, a saved location or exact coords',
    data: new SlashCommandBuilder()
        .setName('teleport')
        .setDescription('Teleport a player')
        .addStringOption((o) => o.setName('player').setDescription('Who to move').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('to').setDescription('Another player').setAutocomplete(true))
        .addStringOption((o) => o.setName('location').setDescription('A saved location').setAutocomplete(true))
        .addStringOption((o) => o.setName('coords').setDescription('x, y, z')),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (!t) return;

        const to = i.options.getString('to');
        const location = i.options.getString('location');
        const raw = i.options.getString('coords');

        if (to) {
            const other = await needOnline(i, to);
            if (!other) return;
            const pos = coords(other.src);
            if (!pos) return fail(i, `Couldn't find where ${other.name} is.`);
            return reply(i, await act.teleport(i.user, t, ...pos, describe(other)));
        }

        if (location) {
            const pos = config.locations[location];
            if (!pos) return fail(i, `No saved location called **${location}**.`);
            return reply(i, await act.teleport(i.user, t, pos.x, pos.y, pos.z, `**${location}**`));
        }

        if (raw) {
            const n = raw.split(/[\s,]+/).filter(Boolean).map(Number);
            if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return fail(i, 'Coords look like `195.2, -933.8, 30.7`.');
            return reply(i, await act.teleport(i.user, t, n[0]!, n[1]!, n[2]!, `\`${n.join(', ')}\``));
        }

        await fail(i, 'Pick where to: another player, a location or coords.');
    },
    async autocomplete(i) {
        const focused = i.options.getFocused(true);
        if (focused.name !== 'location') return suggest(i, false);
        const q = focused.value.toLowerCase();
        await i.respond(
            Object.keys(config.locations)
                .filter((name) => name.toLowerCase().includes(q))
                .slice(0, 25)
                .map((name) => ({ name, value: name })),
        );
    },
};

export const where: Command = {
    category: 'Players',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('where')
        .setDescription('Where a player is right now')
        .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (!t) return;
        const pos = coords(t.src);
        if (!pos) return fail(i, `Couldn't find where ${t.name} is.`);

        // nearest saved location, if one is close enough to be useful
        let near = '';
        let best = 750;
        for (const [name, p] of Object.entries(config.locations)) {
            const d = Math.hypot(p.x - pos[0], p.y - pos[1]);
            if (d < best) [best, near] = [d, name];
        }

        await i.reply({
            content: `${describe(t)} is at \`${pos.map((n) => n.toFixed(2)).join(', ')}\`${near ? `, about ${Math.round(best)}m from **${near}**` : ''}.`,
            flags: MessageFlags.Ephemeral,
        });
    },
    autocomplete: (i) => suggest(i, false),
};
