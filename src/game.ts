// Everything triggered from inside the game: in-game commands, deaths, chat
// and resources starting or stopping.

import type { Message } from 'discord.js';
import { config } from './config';
import { sendable, tierOfDiscord } from './discord';
import { online, resource } from './fivem';
import * as logs from './logs';
import * as reports from './reports';
import * as sessions from './sessions';
import { colors, embed } from './ui';
import { clip } from './util';

const notify = (src: number, description: string, type = 'inform') =>
    emitNet('fivecord:notify', src, { title: config.serverName, description, type });

export const isStaff = (src: number) => tierOfDiscord(sessions.bySrc(src)?.discord) >= 0;

function staffOnline() {
    return online().filter((p) => tierOfDiscord(p.discord) >= 0);
}

export function suggestions(target: number | string) {
    emitNet('chat:addSuggestion', target, `/${config.commands.report}`, 'Send a report to staff', [
        { name: 'message', help: 'What happened?' },
    ]);
    if (target === -1 || isStaff(Number(target))) {
        emitNet('chat:addSuggestion', target, `/${config.commands.staffChat}`, 'Talk to staff in game and on Discord', [
            { name: 'message', help: 'Your message' },
        ]);
    }
}

export function registerCommands() {
    RegisterCommand(
        config.commands.report,
        async (src, args) => {
            if (src <= 0) return;
            const text = args.join(' ').trim();
            if (!text) return notify(src, `Usage: /${config.commands.report} <message>`, 'error');
            try {
                notify(src, await reports.open(src, clip(text, 1500)), 'success');
            } catch (err) {
                console.error('fivecord: report failed:', err);
                notify(src, 'Your report could not be sent. Try again in a moment.', 'error');
            }
        },
        false,
    );

    RegisterCommand(
        config.commands.staffChat,
        async (src, args) => {
            if (src <= 0 || !isStaff(src)) return;
            const text = clip(args.join(' ').trim(), 1000);
            if (!text) return;

            const name = sessions.bySrc(src)?.name ?? GetPlayerName(src);
            for (const p of staffOnline()) emitNet('fivecord:staffChat', p.src, name, text);

            const channel = await sendable(config.channels.staffChat);
            await channel?.send({ content: `**${name}** \`in game\`: ${text}`, allowedMentions: { parse: [] } }).catch(() => {});
        },
        false,
    );
}

// Discord -> game
export async function staffMessage(message: Message) {
    if (message.author.bot || message.channelId !== config.channels.staffChat || !message.content) return;
    const author = message.member?.displayName ?? message.author.username;
    const text = clip(message.cleanContent, 500);
    for (const p of staffOnline()) emitNet('fivecord:staffChat', p.src, `${author} (Discord)`, text);
}

// ---------------------------------------------------------------- deaths

const lastDeath = new Map<number, number>();

onNet('fivecord:died', (killer: unknown, weapon: unknown) => {
    const src = Number(source);
    const at = Date.now();
    if ((lastDeath.get(src) ?? 0) > at - 5000) return;
    lastDeath.set(src, at);

    const victim = sessions.bySrc(src);
    if (!victim) return;

    const k = typeof killer === 'number' && killer > 0 ? sessions.bySrc(killer) : undefined;
    const text = k
        ? `**${k.name}** \`${k.src}\` killed **${victim.name}** \`${src}\``
        : `**${victim.name}** \`${src}\` died`;

    void logs.log('deaths', embed(colors.grey).setDescription(`${text}${typeof weapon === 'number' && k ? `\nWeapon hash \`${weapon >>> 0}\`` : ''}`));
});

on('playerDropped', () => lastDeath.delete(Number(source)));

// ------------------------------------------------------------------ chat

on('chatMessage', (src: number, author: string, text: string) => {
    if (typeof text !== 'string' || text.startsWith('/')) return;
    logs.chat(src, author, text);
});

// ------------------------------------------------------------- resources

on('onResourceStart', (name: string) => {
    if (name === resource) return;
    void logs.log('resources', embed(colors.green).setDescription(`\`${name}\` started`));
});

on('onResourceStop', (name: string) => {
    if (name === resource) return;
    void logs.log('resources', embed(colors.red).setDescription(`\`${name}\` stopped`));
});
