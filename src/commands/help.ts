import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    type RepliableInteraction,
} from 'discord.js';
import { config } from '../config';
import { tierName } from '../discord';
import { colors, embed } from '../ui';
import { commands, handlers, needed, viewerTier } from './registry';
import type { Category, Command } from './types';

const AUTHOR = 'IamZach';
const SUPPORT = 'https://discord.gg/agn';
const VERSION = '1.0.0';

const order: Category[] = ['General', 'Players', 'Moderation', 'Economy', 'Server'];

const blurbs: Record<Category, string> = {
    General: 'Open to everyone',
    Players: 'Find players and look after them',
    Moderation: 'Warnings, kicks, bans and notes',
    Economy: 'Jobs, gangs, money and items',
    Server: 'Restarts, locks, resources and the console',
};

interface Line {
    usage: string;
    text: string;
    need: number;
}

function lines(cmd: Command): Line[] {
    const json = cmd.data.toJSON() as any;

    if (json.type === ApplicationCommandType.User) {
        return [{ usage: `Apps › ${json.name}`, text: cmd.summary ?? '', need: needed(cmd) }];
    }

    const subs = (json.options ?? []).filter((o: any) => o.type === ApplicationCommandOptionType.Subcommand);
    if (!subs.length) {
        return [{ usage: `/${json.name}`, text: cmd.summary ?? json.description, need: needed(cmd) }];
    }
    return subs.map((s: any) => ({ usage: `/${json.name} ${s.name}`, text: s.description, need: needed(cmd, s.name) }));
}

const credit = () => `Made by **${AUTHOR}** · need help? [Join the support server](${SUPPORT})`;

function supportRow() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join the support server').setURL(SUPPORT),
    );
}

function menu(current: Category | 'home') {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help')
            .setPlaceholder('Pick a category')
            .addOptions(
                { label: 'Overview', value: 'home', default: current === 'home' },
                ...order.map((c) => ({ label: c, description: blurbs[c], value: c, default: current === c })),
            ),
    );
}

function page(category: Category | 'home', tier: number) {
    const e = embed(colors.brand)
        .setAuthor({ name: `fivecord ${VERSION}` })
        .setFooter({ text: `fivecord by ${AUTHOR} · discord.gg/agn` });

    if (category === 'home') {
        const all = commands.flatMap(lines);
        const usable = all.filter((l) => l.need <= tier).length;
        e.setTitle(`Running ${config.serverName} from Discord`)
            .setDescription(
                [
                    `**${all.length}** commands. You can use **${usable}** of them as **${tier >= 0 ? tierName(tier) : 'a member'}**.`,
                    '',
                    ...order.map((c) => `**${c}** · ${blurbs[c]} · ${commands.filter((x) => x.category === c).flatMap(lines).length}`),
                    '',
                    'Pick a category below to see every command.',
                    '',
                    credit(),
                ].join('\n'),
            );
    } else {
        const list = commands.filter((c) => c.category === category).flatMap(lines);
        e.setTitle(category).setDescription(
            [
                ...list.map((l) => {
                    const lock = l.need > tier ? ' 🔒' : '';
                    const who = l.need < 0 ? 'everyone' : tierName(l.need);
                    return `\`${l.usage}\`${lock}\n${l.text} · *${who}*`;
                }),
                '',
                credit(),
            ].join('\n'),
        );
    }

    return { embeds: [e], components: [menu(category), supportRow()] };
}

async function show(i: RepliableInteraction) {
    await i.reply({ ...page('home', await viewerTier(i)), flags: MessageFlags.Ephemeral });
}

export const help: Command = {
    category: 'General',
    tier: null,
    summary: 'Every command, who can use it, and where to get help',
    data: new SlashCommandBuilder().setName('help').setDescription('Every fivecord command'),
    run: (i) => show(i),
};

handlers.push({
    prefix: 'help',
    async run(i) {
        if (!i.isStringSelectMenu()) return;
        await i.update(page(i.values[0] as Category | 'home', await viewerTier(i)));
    },
});
