import {
    ActionRowBuilder,
    ApplicationCommandType,
    ButtonBuilder,
    ButtonStyle,
    ContextMenuCommandBuilder,
    MessageFlags,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import * as bans from '../bans';
import * as bridge from '../bridge';
import { db } from '../db';
import { client } from '../discord';
import { identifiers, maxPlayers, online, pick } from '../fivem';
import * as sessions from '../sessions';
import { query } from '../store/mysql';
import { ref, resolve, suggest, type Target } from '../targets';
import { colors, embed, fail, footer, pager } from '../ui';
import { clip, formatDuration, money, now, ts } from '../util';
import { isFrozen } from '../actions';
import { allowed, handlers, viewerTier } from './registry';
import type { Command } from './types';

// ------------------------------------------------------------------ /players

const PER_PAGE = 20;

function playersPage(page: number, search?: string) {
    const q = search?.toLowerCase();
    const list = online().filter((p) => !q || p.name.toLowerCase().includes(q));
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

    const e = footer(embed(colors.teal))
        .setTitle(`${list.length} / ${maxPlayers()} online${q ? ` matching "${clip(search!, 30)}"` : ''}`)
        .setDescription(
            slice.length
                ? slice.map((p) => `\`${String(p.src).padStart(3)}\` ${p.name}${p.discord ? ` · <@${p.discord}>` : ''} · ${p.ping}ms`).join('\n')
                : 'Nobody is online.',
        );

    const components: ActionRowBuilder<any>[] = [pager('players', page, pages)];
    if (slice.length) {
        components.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('pick')
                    .setPlaceholder('Look up a player')
                    .addOptions(slice.map((p) => ({ label: clip(`${p.src} · ${p.name}`, 100), value: `@${p.src}` }))),
            ),
        );
    }
    return { embeds: [e], components };
}

export const players: Command = {
    category: 'Players',
    tier: 'support',
    data: new SlashCommandBuilder()
        .setName('players')
        .setDescription('Everyone online right now')
        .addStringOption((o) => o.setName('search').setDescription('Filter by name')),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        await i.reply({ ...playersPage(0, i.options.getString('search') ?? undefined), flags: MessageFlags.Ephemeral });
    },
};

handlers.push({
    prefix: 'players',
    async run(i, [page]) {
        if (!i.isButton() || !(await allowed(i, 'players'))) return;
        await i.update(playersPage(Number(page)));
    },
});

handlers.push({
    prefix: 'pick',
    async run(i) {
        if (!i.isStringSelectMenu() || !(await allowed(i, 'lookup'))) return;
        const t = await resolve(i.values[0]!);
        if (!t) return fail(i, 'That player has left.');
        await i.reply({ ...(await profile(t, await viewerTier(i))), flags: MessageFlags.Ephemeral });
    },
});

// ------------------------------------------------------------------- profile

async function vehicles(char: bridge.Character, fw: bridge.Framework): Promise<string[] | undefined> {
    if (db().kind !== 'mysql') return undefined;
    const sql =
        fw === 'esx'
            ? 'SELECT plate FROM owned_vehicles WHERE owner = ?'
            : fw === 'qb' || fw === 'qbx'
              ? 'SELECT plate FROM player_vehicles WHERE citizenid = ?'
              : undefined;
    if (!sql) return undefined;
    const rows = await query<{ plate: string }[]>(sql, [char.id]).catch(() => undefined);
    return rows?.map((r) => String(r.plate).trim());
}

const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

export async function profile(t: Target, tier: number) {
    const live = t.src != null ? sessions.bySrc(t.src) : undefined;
    const [record, warnings, notes] = await Promise.all([
        t.license ? db().player(t.license) : undefined,
        t.license ? db().entries('warning', t.license) : [],
        t.license ? db().entries('note', t.license) : [],
    ]);
    const history = t.license ? bans.forLicense(t.license) : [];
    const active = history.find((b) => bans.isActive(b));
    const discord = t.discord ?? record?.discord;

    const status =
        t.src != null
            ? `**Online** · id \`${t.src}\` · ${GetPlayerPing(t.src)}ms${live ? ` · on for ${formatDuration(now() - live.joined)}` : ''}${isFrozen(t.src) ? ' · **frozen**' : ''}`
            : `**Offline**${record ? ` · last seen ${ts(record.lastSeen)}` : ''}`;

    const e = footer(embed(active ? colors.red : t.src != null ? colors.teal : colors.grey))
        .setTitle(t.name)
        .setDescription([status, discord ? `<@${discord}>` : 'Discord not linked'].join('\n'));

    if (discord) {
        const user = await client.users.fetch(discord).catch(() => undefined);
        if (user) e.setThumbnail(user.displayAvatarURL({ size: 128 }));
    }

    if (record) {
        const unsaved = live ? now() - live.counted : 0;
        e.addFields({
            name: 'Account',
            value: `First seen ${ts(record.firstSeen, 'D')}\nPlaytime **${formatDuration(record.playtime + unsaved)}**`,
            inline: true,
        });
    }

    if (t.src != null) {
        const [char, fw] = await Promise.all([bridge.character(t.src).catch(() => undefined), bridge.framework().catch(() => 'none' as const)]);
        if (char) {
            const cash = Object.entries(char.money ?? {})
                .filter(([k]) => ['cash', 'money', 'bank', 'black_money', 'crypto'].includes(k))
                .map(([k, v]) => `${k.replace('_', ' ')} ${money(v)}`)
                .join(' · ');
            e.addFields({
                name: 'Character',
                value: [
                    `**${char.name}** · \`${char.id}\``,
                    `${char.jobLabel} · ${char.gradeLabel}`,
                    char.gang && char.gang !== 'none' ? `Gang: ${char.gangLabel ?? char.gang}` : '',
                    cash,
                ]
                    .filter(Boolean)
                    .join('\n'),
                inline: true,
            });

            const plates = await vehicles(char, fw);
            if (plates) {
                e.addFields({
                    name: `Vehicles (${plates.length})`,
                    value: plates.length ? clip(plates.map((p) => `\`${p}\``).join(' '), 1000) : 'None',
                    inline: false,
                });
            }
        }
    }

    e.addFields({
        name: 'Record',
        value: [
            `${warnings.length} warning${warnings.length === 1 ? '' : 's'} · ${history.length} ban${history.length === 1 ? '' : 's'}`,
            active
                ? `**Banned** #${active.id} · ${active.expires ? `ends ${ts(active.expires)}` : 'permanent'}\n${clip(active.reason, 200)}`
                : '',
        ]
            .filter(Boolean)
            .join('\n'),
        inline: false,
    });

    if (warnings.length) {
        e.addFields({
            name: 'Latest warnings',
            value: warnings
                .slice(0, 3)
                .map((w) => `\`#${w.id}\` ${clip(w.text, 120)} · ${w.staff} ${ts(w.created)}`)
                .join('\n'),
        });
    }

    if (notes.length) {
        e.addFields({
            name: 'Staff notes',
            value: notes
                .slice(0, 3)
                .map((n) => `\`#${n.id}\` ${clip(n.text, 160)} · ${n.staff} ${ts(n.created)}`)
                .join('\n'),
        });
    }

    const ids = t.src != null ? identifiers(t.src) : (record?.identifiers ?? []);
    const shown = ['license', 'license2', 'discord', 'fivem', 'steam', 'xbl', 'live'].map((k) => pick(ids, k)).filter(Boolean);
    if (shown.length) e.addFields({ name: 'Identifiers', value: `\`\`\`\n${shown.join('\n')}\n\`\`\`` });

    const r = ref(t);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    if (tier >= 0) {
        if (t.src != null) {
            rows.push(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    button(`lookup:${r}:r`, 'Refresh'),
                    button(`act:message:${r}`, 'Message'),
                    button(`act:warn:${r}`, 'Warn'),
                    button(`act:note:${r}`, 'Note'),
                    button(`act:screenshot:${r}`, 'Screenshot'),
                ),
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    button(`act:revive:${r}`, 'Revive', ButtonStyle.Success),
                    button(`act:freeze:${r}`, isFrozen(t.src) ? 'Unfreeze' : 'Freeze', ButtonStyle.Primary),
                    button(`act:kick:${r}`, 'Kick', ButtonStyle.Danger),
                    button(`act:ban:${r}`, 'Ban', ButtonStyle.Danger),
                ),
            );
        } else if (t.license) {
            rows.push(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    button(`lookup:${r}:r`, 'Refresh'),
                    button(`act:warn:${r}`, 'Warn'),
                    button(`act:note:${r}`, 'Note'),
                    active
                        ? button(`act:unban:${active.id}`, `Lift ban #${active.id}`, ButtonStyle.Success)
                        : button(`act:ban:${r}`, 'Ban', ButtonStyle.Danger),
                ),
            );
        }
    }

    return { embeds: [e], components: rows };
}

// ------------------------------------------------------------------- /lookup

export const lookup: Command = {
    category: 'Players',
    tier: 'support',
    summary: 'Everything about a player: account, character, money, vehicles, warnings, bans and notes',
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Look up a player, online or not')
        .addStringOption((o) => o.setName('player').setDescription('Name, server id, license or Discord user').setRequired(true).setAutocomplete(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const t = await resolve(i.options.getString('player', true));
        if (!t) return fail(i, 'No player found.');
        await i.editReply(await profile(t, await viewerTier(i)));
    },
    autocomplete: (i) => suggest(i),
};

export const lookupUser: Command = {
    category: 'Players',
    tier: 'support',
    summary: 'Right click a Discord member > Apps > Look up in FiveM',
    data: new ContextMenuCommandBuilder().setName('Look up in FiveM').setType(ApplicationCommandType.User),
    async run(i) {
        if (!i.isUserContextMenuCommand()) return;
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const t = await resolve(i.targetId);
        if (!t) return fail(i, `<@${i.targetId}> has never played on the server.`);
        await i.editReply(await profile(t, await viewerTier(i)));
    },
};

// from report threads (new reply) and the Refresh button (same message)
handlers.push({
    prefix: 'lookup',
    async run(i, [value, mode]) {
        if (!i.isButton() || !value || !(await allowed(i, 'lookup'))) return;
        const t = await resolve(value);
        if (!t) return fail(i, 'That player could not be found any more.');
        const view = await profile(t, await viewerTier(i));
        if (mode === 'r') await i.update(view);
        else await i.reply({ ...view, flags: MessageFlags.Ephemeral });
    },
});
