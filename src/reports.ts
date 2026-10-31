import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    type ButtonInteraction,
    type Message,
    type ThreadChannel,
} from 'discord.js';
import { config } from './config';
import { client } from './discord';
import { coords, isOnline } from './fivem';
import { audit } from './logs';
import * as sessions from './sessions';
import { colors, embed, staffName } from './ui';
import { clip, now, ts } from './util';

export interface Report {
    id: number;
    src: number;
    name: string;
    license?: string;
    thread: string;
    opened: number;
    claimedBy?: string;
    messages: { from: string; staff: boolean; text: string; at: number }[];
}

let next = 1;
const bySrc = new Map<number, Report>();
const byThread = new Map<string, Report>();
const lastOpened = new Map<string, number>();

export const forThread = (id: string) => byThread.get(id);
export const forPlayer = (src: number) => bySrc.get(src);
export const openCount = () => bySrc.size;
export const list = () => [...bySrc.values()].sort((a, b) => a.id - b.id);
export const byId = (id: number) => [...bySrc.values()].find((r) => r.id === id);

const remember = (r: Report, from: string, staff: boolean, text: string) =>
    r.messages.push({ from, staff, text: clip(text, 1000), at: now() });

function buttons(r: Report, closed = false) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`report:claim:${r.id}`)
            .setLabel(r.claimedBy ? `Claimed by ${r.claimedBy}`.slice(0, 80) : 'Claim')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(closed || Boolean(r.claimedBy)),
        new ButtonBuilder()
            .setCustomId(`lookup:@${r.src}`)
            .setLabel('Look up')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(closed),
        new ButtonBuilder()
            .setCustomId(`report:close:${r.id}`)
            .setLabel(closed ? 'Closed' : 'Close')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(closed),
    );
}

function card(r: Report, text: string) {
    const s = sessions.bySrc(r.src);
    const pos = coords(r.src);
    return embed(colors.amber)
        .setTitle(`Report #${r.id}`)
        .setDescription(clip(text, 3000))
        .addFields(
            { name: 'Player', value: `**${r.name}** · \`${r.src}\``, inline: true },
            { name: 'Discord', value: s?.discord ? `<@${s.discord}>` : 'not linked', inline: true },
            { name: 'Opened', value: ts(r.opened), inline: true },
            ...(pos ? [{ name: 'Position', value: `\`${pos.map((n) => n.toFixed(1)).join(', ')}\``, inline: false }] : []),
        )
        .setFooter({ text: 'Anything you write in this thread is sent to the player in game.' });
}

export async function open(src: number, text: string): Promise<string> {
    const existing = bySrc.get(src);
    if (existing) {
        remember(existing, existing.name, false, text);
        const thread = await findThread(existing);
        await thread?.send({ embeds: [embed(colors.amber).setAuthor({ name: existing.name }).setDescription(clip(text, 3000))] });
        return 'Added to your open report.';
    }

    const s = sessions.bySrc(src);
    const key = s?.license ?? String(src);
    const wait = (lastOpened.get(key) ?? 0) + config.commands.reportCooldown - now();
    if (wait > 0) return `Please wait ${wait}s before opening another report.`;

    const channel = config.channels.reports && (await client.channels.fetch(config.channels.reports).catch(() => null));
    if (!channel) return 'Reports are not set up on this server.';

    const r: Report = { id: next++, src, name: s?.name ?? GetPlayerName(src), license: s?.license, thread: '', opened: now(), messages: [] };
    remember(r, r.name, false, text);
    const title = clip(`#${r.id} · ${r.name} · ${text}`, 90);
    const ping = config.alertRole ? `<@&${config.alertRole}>` : undefined;
    const message = { content: ping, embeds: [card(r, text)], components: [buttons(r)], allowedMentions: { roles: ping ? [config.alertRole] : [] } };

    let thread: ThreadChannel;
    if (channel.type === ChannelType.GuildForum) {
        thread = await channel.threads.create({ name: title, message });
    } else if (channel.type === ChannelType.GuildText) {
        const starter = await channel.send(message);
        thread = await starter.startThread({ name: title, autoArchiveDuration: 1440 });
    } else {
        return 'Reports are not set up on this server.';
    }

    r.thread = thread.id;
    bySrc.set(src, r);
    byThread.set(thread.id, r);
    lastOpened.set(key, r.opened);
    return `Report #${r.id} sent. Staff replies will show up in your chat.`;
}

async function findThread(r: Report): Promise<ThreadChannel | undefined> {
    const channel = await client.channels.fetch(r.thread).catch(() => null);
    return channel?.isThread() ? channel : undefined;
}

async function starter(thread: ThreadChannel): Promise<Message | undefined> {
    if (thread.parent?.type === ChannelType.GuildForum) return (await thread.fetchStarterMessage().catch(() => null)) ?? undefined;
    return thread.parent?.isTextBased() ? thread.parent.messages.fetch(thread.id).catch(() => undefined) : undefined;
}

async function setButtons(r: Report, closed: boolean) {
    const thread = await findThread(r);
    const msg = thread && (await starter(thread));
    await msg?.edit({ components: [buttons(r, closed)] }).catch(() => {});
    return thread;
}

export async function close(r: Report, by: string, note?: string) {
    bySrc.delete(r.src);
    byThread.delete(r.thread);

    if (isOnline(r.src)) {
        emitNet('fivecord:reportReply', r.src, by, note ?? `Your report #${r.id} was closed.`);
    }

    const thread = await setButtons(r, true);
    if (thread) {
        await thread.send({ embeds: [embed(colors.grey).setDescription(`Closed by **${by}**${note ? `\n${note}` : ''}`)] }).catch(() => {});
        await thread.setLocked(true).catch(() => {});
        await thread.setArchived(true).catch(() => {});
    }
}

// a staff message in a report thread goes to the player
export async function relay(message: Message) {
    const r = byThread.get(message.channelId);
    if (!r || message.author.bot || !message.content) return;

    if (!isOnline(r.src)) {
        await message.react('❌').catch(() => {});
        return;
    }

    const author = message.member?.displayName ?? message.author.username;
    remember(r, author, true, message.content);
    emitNet('fivecord:reportReply', r.src, author, clip(message.content, 500));
    await message.react('✅').catch(() => {});
}

export async function playerLeft(src: number) {
    const r = bySrc.get(src);
    if (!r) return;
    const thread = await findThread(r);
    await thread?.send({ embeds: [embed(colors.grey).setDescription(`**${r.name}** left the server.`)] }).catch(() => {});
    await close(r, 'fivecord', 'The player left the server.');
}

// From somewhere other than the thread, like the web panel.
export async function reply(r: Report, by: string, text: string) {
    remember(r, by, true, text);
    if (isOnline(r.src)) emitNet('fivecord:reportReply', r.src, by, clip(text, 500));
    const thread = await findThread(r);
    await thread?.send({ embeds: [embed(colors.teal).setAuthor({ name: by }).setDescription(clip(text, 3000))] }).catch(() => {});
}

export async function claim(r: Report, by: string) {
    r.claimedBy = by;
    await setButtons(r, false);
    const thread = await findThread(r);
    await thread?.send({ embeds: [embed(colors.teal).setDescription(`**${by}** is handling this report.`)] }).catch(() => {});
    if (isOnline(r.src)) emitNet('fivecord:reportReply', r.src, by, 'is looking at your report.');
}

export async function button(i: ButtonInteraction, action: string, id: number) {
    const r = [...bySrc.values()].find((x) => x.id === id);
    if (!r) {
        await i.update({ components: [] }).catch(() => {});
        return;
    }

    const name = i.member && 'displayName' in i.member ? i.member.displayName : staffName(i.user);

    if (action === 'claim') {
        r.claimedBy = name;
        await i.update({ components: [buttons(r)] });
        await i.followUp({ embeds: [embed(colors.teal).setDescription(`**${name}** is handling this report.`)] });
        if (isOnline(r.src)) emitNet('fivecord:reportReply', r.src, name, 'is looking at your report.');
        audit(i.user, 'Claimed report', `#${r.id}`, r.name);
    } else if (action === 'close') {
        await i.deferUpdate();
        await close(r, name);
        audit(i.user, 'Closed report', `#${r.id}`, r.name);
    }
}
