import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    type RepliableInteraction,
    type User,
} from 'discord.js';
import { config } from './config';

export const colors = {
    brand: 0x9c2cf1,
    teal: 0x2bd9cc,
    green: 0x3dd68c,
    amber: 0xf5a524,
    red: 0xe5484d,
    grey: 0x4b4b5c,
} as const;

export const embed = (color: number = colors.brand) => new EmbedBuilder().setColor(color);

export const footer = (e: EmbedBuilder) => e.setFooter({ text: config.serverName }).setTimestamp();

export const staffName = (user: User) => user.globalName ?? user.username;

async function respond(i: RepliableInteraction, text: string, color: number) {
    const payload = { embeds: [embed(color).setDescription(text)], components: [] };
    if (i.deferred || i.replied) await i.editReply(payload);
    else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export const done = (i: RepliableInteraction, text: string) => respond(i, text, colors.green);
export const fail = (i: RepliableInteraction, text: string) => respond(i, text, colors.red);

export function pager(prefix: string, page: number, pages: number, extra = '') {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}:${page - 1}${extra}`)
            .setEmoji('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}:${page}${extra}:r`)
            .setLabel(`${page + 1} / ${Math.max(1, pages)}`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${prefix}:${page + 1}${extra}`)
            .setEmoji('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= pages - 1),
    );
}
