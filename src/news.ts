// The latest post in Config.channels.news, for loading screens and the like.

import type { Message } from 'discord.js';
import { config } from './config';
import { sendable } from './discord';
import { clip } from './util';

export interface News {
    author: string;
    text: string;
    at: number;
}

let latest: News | undefined;

const toNews = (m: Message): News | undefined => {
    const text = m.content || m.embeds[0]?.description || '';
    if (!text) return undefined;
    return { author: m.member?.displayName ?? m.author.displayName, text: clip(text, 600), at: Math.floor(m.createdTimestamp / 1000) };
};

export async function loadNews() {
    const channel = await sendable(config.channels.news);
    if (!channel || !('messages' in channel)) return;
    const [m] = (await channel.messages.fetch({ limit: 1 }).catch(() => undefined))?.values() ?? [];
    latest = m && toNews(m);
}

export function onMessage(m: Message) {
    if (m.channelId === config.channels.news) latest = toNews(m) ?? latest;
}

export const getNews = () => latest;
