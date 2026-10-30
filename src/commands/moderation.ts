import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    type AutocompleteInteraction,
    type RepliableInteraction,
} from 'discord.js';
import * as act from '../actions';
import * as bans from '../bans';
import { db } from '../db';
import type { Ban } from '../store/types';
import { describe, need, needOnline, resolve, suggest } from '../targets';
import { audit } from '../logs';
import { colors, done, embed, fail, footer, pager, staffName } from '../ui';
import { clip, formatDuration, now, parseDuration, ts } from '../util';
import { allowed, handlers } from './registry';
import type { Command } from './types';

async function send(i: RepliableInteraction, r: act.Result) {
    if (!r.ok) return fail(i, r.text);
    if (!r.files) return done(i, r.text);
    const payload = { embeds: [embed(colors.green).setDescription(r.text).setImage(`attachment://${r.files[0]!.name}`)], files: r.files };
    if (i.deferred || i.replied) await i.editReply(payload);
    else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

const playerOption = (description = 'Name, server id, license or Discord user') => (o: any) =>
    o.setName('player').setDescription(description).setRequired(true).setAutocomplete(true);

const onlineOnly = (i: AutocompleteInteraction) => suggest(i, false);

// ------------------------------------------------------------- simple ones

export const message: Command = {
    category: 'Moderation',
    tier: 'support',
    summary: 'Pop up a message on a player\'s screen',
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Send a player a message in game')
        .addStringOption(playerOption('Who to message'))
        .addStringOption((o) => o.setName('text').setDescription('The message').setRequired(true).setMaxLength(500)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (t) await send(i, await act.message(i.user, t, i.options.getString('text', true)));
    },
    autocomplete: onlineOnly,
};

export const warn: Command = {
    category: 'Moderation',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a player. It goes on their record and pops up in game')
        .addStringOption(playerOption())
        .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(500)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await need(i, i.options.getString('player', true));
        if (t) await send(i, await act.warn(i.user, t, i.options.getString('reason', true)));
    },
    autocomplete: (i) => suggest(i),
};

export const kick: Command = {
    category: 'Moderation',
    tier: 'mod',
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a player from the server')
        .addStringOption(playerOption())
        .addStringOption((o) => o.setName('reason').setDescription('Shown to the player').setRequired(true).setMaxLength(300)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (t) await send(i, await act.kick(i.user, t, i.options.getString('reason', true)));
    },
    autocomplete: onlineOnly,
};

export const freeze: Command = {
    category: 'Moderation',
    tier: 'mod',
    data: new SlashCommandBuilder()
        .setName('freeze')
        .setDescription('Freeze or unfreeze a player')
        .addStringOption(playerOption())
        .addBooleanOption((o) => o.setName('frozen').setDescription('Leave empty to toggle')),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (t) await send(i, await act.freeze(i.user, t, i.options.getBoolean('frozen') ?? undefined));
    },
    autocomplete: onlineOnly,
};

export const screenshot: Command = {
    category: 'Moderation',
    tier: 'mod',
    summary: "See a player's screen right now (needs screenshot-basic)",
    data: new SlashCommandBuilder()
        .setName('screenshot')
        .setDescription("Take a screenshot of a player's screen")
        .addStringOption(playerOption()),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (!t) return;
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await send(i, await act.screenshot(i.user, t));
    },
    autocomplete: onlineOnly,
};

// ---------------------------------------------------------- warnings, notes

export const warnings: Command = {
    category: 'Moderation',
    tier: 'support',
    tiers: { view: 'support', remove: 'mod', clear: 'admin' },
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('A player\'s warnings')
        .addSubcommand((s) => s.setName('view').setDescription('Every warning on a player').addStringOption(playerOption()))
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove one warning')
                .addIntegerOption((o) => o.setName('id').setDescription('Warning id, shown in /warnings view').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('clear').setDescription('Remove all of a player\'s warnings').addStringOption(playerOption())),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const sub = i.options.getSubcommand();

        if (sub === 'remove') {
            const w = await db().removeEntry('warning', i.options.getInteger('id', true));
            if (!w) return fail(i, 'No warning with that id.');
            audit(i.user, 'Removed warning', `#${w.id}`, w.text);
            return done(i, `Removed warning #${w.id}: ${clip(w.text, 200)}`);
        }

        const t = await need(i, i.options.getString('player', true));
        if (!t?.license) return t && fail(i, `${t.name} has no license on record.`);
        const list = await db().entries('warning', t.license);

        if (sub === 'clear') {
            for (const w of list) await db().removeEntry('warning', w.id);
            audit(i.user, 'Cleared warnings', describe(t), `${list.length} removed`);
            return done(i, `Cleared ${list.length} warning${list.length === 1 ? '' : 's'} from ${describe(t)}.`);
        }

        const e = footer(embed(colors.amber)).setTitle(`${t.name} · ${list.length} warning${list.length === 1 ? '' : 's'}`);
        e.setDescription(
            list.length
                ? clip(list.map((w) => `\`#${w.id}\` ${ts(w.created, 'd')} · **${w.staff}**\n${clip(w.text, 300)}`).join('\n\n'), 4000)
                : 'Clean record.',
        );
        await i.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    },
    autocomplete: (i) => suggest(i),
};

export const note: Command = {
    category: 'Moderation',
    tier: 'support',
    summary: 'Private staff notes that show up on /lookup',
    data: new SlashCommandBuilder()
        .setName('note')
        .setDescription('Staff notes on a player')
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Add a note')
                .addStringOption(playerOption())
                .addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(1000)),
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove a note')
                .addIntegerOption((o) => o.setName('id').setDescription('Note id, shown on /lookup').setRequired(true)),
        ),
    async run(i) {
        if (!i.isChatInputCommand()) return;

        if (i.options.getSubcommand() === 'remove') {
            const n = await db().removeEntry('note', i.options.getInteger('id', true));
            if (!n) return fail(i, 'No note with that id.');
            audit(i.user, 'Removed note', `#${n.id}`, n.text);
            return done(i, `Removed note #${n.id}.`);
        }

        const t = await need(i, i.options.getString('player', true));
        if (!t?.license) return t && fail(i, `${t.name} has no license on record.`);
        await addNote(i, t.license, t.name, i.options.getString('text', true));
    },
    autocomplete: (i) => suggest(i),
};

async function addNote(i: RepliableInteraction, license: string, name: string, text: string) {
    const id = await db().addEntry('note', { license, text, staff: staffName(i.user), created: now() });
    audit(i.user, 'Added note', `**${name}**`, text);
    await done(i, `Added note #${id} to **${name}**.`);
}

// --------------------------------------------------------------------- bans

const lengths = ['1h', '6h', '1d', '3d', '7d', '14d', '30d', 'permanent'];

export const ban: Command = {
    category: 'Moderation',
    tier: 'mod',
    summary: 'Ban a player, online or offline. Catches alt accounts through their hardware tokens',
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a player')
        .addStringOption(playerOption())
        .addStringOption((o) => o.setName('length').setDescription('Like 12h, 3d, 2w or permanent').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('Shown to the player').setRequired(true).setMaxLength(500)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const raw = i.options.getString('player', true);
        const length = parseDuration(i.options.getString('length', true));
        if (length === undefined) return fail(i, 'That length doesn\'t make sense. Try `12h`, `3d`, `2w` or `permanent`.');

        // a license nobody has seen yet can still be banned
        const t = (await resolve(raw)) ?? (raw.startsWith('license:') ? { license: raw, name: raw.slice(8, 20) } : undefined);
        if (!t) return fail(i, `Couldn't find a player matching \`${clip(raw, 50)}\`.`);
        await send(i, await act.ban(i.user, t, length, i.options.getString('reason', true)));
    },
    async autocomplete(i) {
        if (i.options.getFocused(true).name !== 'length') return suggest(i);
        const q = i.options.getFocused().toLowerCase();
        const typed = parseDuration(q) !== undefined && q && !lengths.includes(q) ? [q] : [];
        await i.respond([...typed, ...lengths].filter((l) => l.startsWith(q) || typed.includes(l)).slice(0, 25).map((l) => ({ name: l, value: l })));
    },
};

function banSuggestions(q: string) {
    return bans
        .list(true, q || undefined)
        .slice(0, 25)
        .map((b) => ({ name: clip(`#${b.id} · ${b.name} · ${b.reason}`, 100), value: b.id }));
}

export const unban: Command = {
    category: 'Moderation',
    tier: 'mod',
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Lift a ban')
        .addIntegerOption((o) => o.setName('ban').setDescription('Ban id or player name').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why it was lifted').setMaxLength(300)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        await send(i, await act.unban(i.user, i.options.getInteger('ban', true), i.options.getString('reason') ?? 'No reason given'));
    },
    autocomplete: (i) => i.respond(banSuggestions(i.options.getFocused())),
};

export function banCard(b: Ban) {
    const active = bans.isActive(b);
    const status = b.revokedAt
        ? `Lifted by **${b.revokedBy}** ${ts(b.revokedAt)}`
        : active
          ? b.expires
              ? `Active · ends ${ts(b.expires)} (${ts(b.expires, 'f')})`
              : 'Active · permanent'
          : `Expired ${ts(b.expires!)}`;

    const e = footer(embed(active ? colors.red : colors.grey))
        .setTitle(`Ban #${b.id} · ${b.name}`)
        .setDescription(clip(b.reason, 2000))
        .addFields(
            { name: 'Status', value: status },
            { name: 'Banned by', value: b.staff, inline: true },
            { name: 'When', value: ts(b.created, 'f'), inline: true },
            { name: 'Length', value: b.expires ? formatDuration(b.expires - b.created) : 'Permanent', inline: true },
            { name: 'Covers', value: `${b.identifiers.length} identifiers · ${b.tokens.length} hardware tokens\n\`${b.license}\`` },
        );

    const components = active
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`act:unban:${b.id}`).setLabel('Lift ban').setStyle(ButtonStyle.Success))]
        : [];
    return { embeds: [e], components };
}

const BANS_PER_PAGE = 10;

function bansPage(page: number, all: boolean, search: string) {
    const list = bans.list(!all, search || undefined);
    const pages = Math.max(1, Math.ceil(list.length / BANS_PER_PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = list.slice(page * BANS_PER_PAGE, (page + 1) * BANS_PER_PAGE);

    const e = footer(embed(colors.red))
        .setTitle(`${list.length} ${all ? '' : 'active '}ban${list.length === 1 ? '' : 's'}${search ? ` matching "${clip(search, 30)}"` : ''}`)
        .setDescription(
            slice.length
                ? slice
                      .map((b) => `\`#${b.id}\` **${b.name}** · ${b.expires ? `ends ${ts(b.expires)}` : 'permanent'}${bans.isActive(b) ? '' : ' · inactive'}\n${clip(b.reason, 90)}`)
                      .join('\n')
                : 'No bans.',
        );

    const extra = `:${all ? 'a' : 'x'}:${encodeURIComponent(search).slice(0, 40)}`;
    const components: ActionRowBuilder<any>[] = [pager('bans', page, pages, extra)];
    if (slice.length) {
        components.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ban')
                    .setPlaceholder('Open a ban')
                    .addOptions(slice.map((b) => ({ label: clip(`#${b.id} · ${b.name}`, 100), description: clip(b.reason, 100), value: String(b.id) }))),
            ),
        );
    }
    return { embeds: [e], components };
}

export const bansCommand: Command = {
    category: 'Moderation',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('bans')
        .setDescription('Browse bans')
        .addStringOption((o) => o.setName('search').setDescription('Player name, license or reason'))
        .addBooleanOption((o) => o.setName('all').setDescription('Include expired and lifted bans')),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        await i.reply({ ...bansPage(0, i.options.getBoolean('all') ?? false, i.options.getString('search') ?? ''), flags: MessageFlags.Ephemeral });
    },
};

handlers.push({
    prefix: 'bans',
    async run(i, [page, all, search]) {
        if (!i.isButton() || !(await allowed(i, 'bans'))) return;
        await i.update(bansPage(Number(page), all === 'a', decodeURIComponent(search ?? '')));
    },
});

handlers.push({
    prefix: 'ban',
    async run(i) {
        if (!i.isStringSelectMenu() || !(await allowed(i, 'bans'))) return;
        const b = bans.get(Number(i.values[0]));
        if (!b) return fail(i, 'That ban is gone.');
        await i.reply({ ...banCard(b), flags: MessageFlags.Ephemeral });
    },
});

// ------------------------------------------------- buttons on /lookup and bans

const forms: Record<string, { title: string; label: string; length?: boolean; max: number }> = {
    message: { title: 'Message player', label: 'Message', max: 500 },
    warn: { title: 'Warn player', label: 'Reason', max: 500 },
    note: { title: 'Add a staff note', label: 'Note', max: 1000 },
    kick: { title: 'Kick player', label: 'Reason (they see this)', max: 300 },
    ban: { title: 'Ban player', label: 'Reason (they see this)', length: true, max: 500 },
};

function form(action: string, r: string) {
    const f = forms[action]!;
    const modal = new ModalBuilder().setCustomId(`form:${action}:${r}`).setTitle(f.title);
    if (f.length) {
        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('length').setLabel('Length').setPlaceholder('12h, 3d, 2w or permanent').setStyle(TextInputStyle.Short).setRequired(true),
            ),
        );
    }
    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('text').setLabel(f.label).setStyle(TextInputStyle.Paragraph).setMaxLength(f.max).setRequired(true),
        ),
    );
    return modal;
}

handlers.push({
    prefix: 'act',
    async run(i, [action, r]) {
        if (!i.isButton() || !action || !r || !(await allowed(i, action))) return;

        if (action === 'unban') return send(i, await act.unban(i.user, Number(r), 'Lifted from Discord'));
        if (forms[action]) return i.showModal(form(action, r));

        const t = await needOnline(i, r);
        if (!t) return;

        if (action === 'freeze') return send(i, await act.freeze(i.user, t));
        if (action === 'revive') return send(i, await act.revive(i.user, t));
        if (action === 'screenshot') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            return send(i, await act.screenshot(i.user, t));
        }
    },
});

handlers.push({
    prefix: 'form',
    async run(i, [action, r]) {
        if (!i.isModalSubmit() || !action || !r || !(await allowed(i, action))) return;
        const text = i.fields.getTextInputValue('text');

        if (action === 'ban') {
            const length = parseDuration(i.fields.getTextInputValue('length'));
            if (length === undefined) return fail(i, 'That length doesn\'t make sense. Try `12h`, `3d`, `2w` or `permanent`.');
            const t = await need(i, r);
            return t && send(i, await act.ban(i.user, t, length, text));
        }

        if (action === 'warn' || action === 'note') {
            const t = await need(i, r);
            if (!t) return;
            if (action === 'warn') return send(i, await act.warn(i.user, t, text));
            if (!t.license) return fail(i, `${t.name} has no license on record.`);
            return addNote(i, t.license, t.name, text);
        }

        const t = await needOnline(i, r);
        if (!t) return;
        if (action === 'message') return send(i, await act.message(i.user, t, text));
        if (action === 'kick') return send(i, await act.kick(i.user, t, text));
    },
});
