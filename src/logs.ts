import type { AttachmentBuilder, EmbedBuilder, User } from 'discord.js';
import { config } from './config';
import { sendable } from './discord';
import { colors, embed, staffName } from './ui';
import { clip } from './util';

export type LogKind = 'joins' | 'staff' | 'bans' | 'deaths' | 'chat' | 'resources' | (string & {});

const channelFor = (kind: LogKind) => config.logs[kind] ?? config.logs.default;

export async function log(kind: LogKind, e: EmbedBuilder, opts: { ping?: boolean; files?: AttachmentBuilder[] } = {}) {
    const channel = await sendable(channelFor(kind));
    if (!channel) return;

    const ping = opts.ping && config.alertRole ? `<@&${config.alertRole}>` : undefined;
    await channel
        .send({
            content: ping,
            embeds: [e.setTimestamp()],
            files: opts.files,
            allowedMentions: ping ? { roles: [config.alertRole] } : { parse: [] },
        })
        .catch((err) => console.error(`fivecord: could not write ${kind} log: ${err.message}`));
}

// Every action taken through the bot ends up here.
export function audit(user: User, action: string, target?: string, details?: string, color: number = colors.grey) {
    const e = embed(color)
        .setAuthor({ name: staffName(user), iconURL: user.displayAvatarURL() })
        .setDescription(`**${action}**${target ? ` · ${target}` : ''}${details ? `\n${clip(details, 1500)}` : ''}`)
        .setFooter({ text: `Discord ${user.id}` });
    void log('staff', e);
}

// Chat moves too fast for one message per line, so it's sent in batches.
let lines: string[] = [];
let timer: NodeJS.Timeout | undefined;

export function chat(src: number, name: string, text: string) {
    lines.push(`\`${src}\` **${name.replace(/[*_`~|]/g, '')}**: ${clip(text.replace(/`/g, "'"), 300)}`);
    timer ??= setTimeout(flushChat, 5000);
}

export function flushChat() {
    timer = undefined;
    if (!lines.length) return;

    const batch = lines;
    lines = [];

    let current = '';
    for (const line of batch) {
        if (current.length + line.length > 3900) {
            void log('chat', embed(colors.grey).setDescription(current));
            current = '';
        }
        current += `${line}\n`;
    }
    if (current) void log('chat', embed(colors.grey).setDescription(current));
}
