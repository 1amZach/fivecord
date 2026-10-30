import type { AutocompleteInteraction, RepliableInteraction } from 'discord.js';
import { db } from './db';
import { isOnline, online } from './fivem';
import * as sessions from './sessions';
import { fail } from './ui';

// A player picked in a command: online (has src) or someone seen before.
export interface Target {
    src?: number;
    license?: string;
    discord?: string;
    name: string;
}

export type OnlineTarget = Target & { src: number };

// short form for custom ids and autocomplete values: @<server id> or #<license hash>
export const ref = (t: Target) => (t.src != null ? `@${t.src}` : `#${(t.license ?? '').replace(/^license:/, '')}`);

export function describe(t: Target): string {
    const where = t.src != null ? `\`${t.src}\`` : 'offline';
    return `**${t.name}** (${where})`;
}

function fromSrc(src: number): Target | undefined {
    if (!isOnline(src)) return undefined;
    const s = sessions.bySrc(src);
    return { src, name: s?.name ?? GetPlayerName(src), license: s?.license, discord: s?.discord };
}

async function fromLicense(license: string): Promise<Target | undefined> {
    const live = sessions.byLicense(license);
    const t = live && fromSrc(live.src);
    if (t) return t;
    const p = await db().player(license);
    return p && { license: p.license, name: p.name, discord: p.discord };
}

// Accepts what autocomplete sends back (@12, #abc) or whatever staff typed:
// a server id, a license, a Discord mention or id, or part of a name.
export async function resolve(raw: string): Promise<Target | undefined> {
    const value = raw.trim();

    if (/^@\d+$/.test(value)) return fromSrc(Number(value.slice(1)));
    if (value.startsWith('#')) return fromLicense(`license:${value.slice(1).replace(/^license:/, '')}`);
    if (/^\d{1,5}$/.test(value)) return fromSrc(Number(value));
    if (value.startsWith('license:')) return fromLicense(value);

    const mention = value.match(/^<@!?(\d{15,21})>$|^(\d{15,21})$/);
    if (mention) {
        const id = mention[1] ?? mention[2]!;
        const live = sessions.byDiscord(id)[0];
        if (live) return fromSrc(live.src);
        const p = await db().byDiscord(id);
        return p && { license: p.license, name: p.name, discord: p.discord };
    }

    const lower = value.toLowerCase();
    const live = online().find((p) => p.name.toLowerCase() === lower) ?? online().find((p) => p.name.toLowerCase().includes(lower));
    if (live) return fromSrc(live.src);

    const [p] = await db().search(value, 1);
    return p && fromLicense(p.license);
}

export async function suggest(i: AutocompleteInteraction, includeOffline = true) {
    const q = i.options.getFocused().trim().toLowerCase();
    const choices: { name: string; value: string }[] = [];

    for (const p of online()) {
        if (q && !p.name.toLowerCase().includes(q) && String(p.src) !== q) continue;
        choices.push({ name: `${p.src} · ${p.name}`.slice(0, 100), value: `@${p.src}` });
    }

    if (includeOffline && q.length >= 2 && choices.length < 25) {
        const seen = new Set(online().map((p) => p.license));
        for (const p of await db().search(q, 25)) {
            if (seen.has(p.license)) continue;
            choices.push({ name: `offline · ${p.name}`.slice(0, 100), value: ref(p) });
        }
    }

    await i.respond(choices.slice(0, 25)).catch(() => {});
}

export async function need(i: RepliableInteraction, raw: string): Promise<Target | undefined> {
    const t = await resolve(raw);
    if (!t) await fail(i, `Couldn't find a player matching \`${raw.slice(0, 50)}\`.`);
    return t;
}

export async function needOnline(i: RepliableInteraction, raw: string): Promise<OnlineTarget | undefined> {
    const t = await need(i, raw);
    if (t && t.src == null) {
        await fail(i, `${t.name} isn't online right now.`);
        return undefined;
    }
    return t as OnlineTarget | undefined;
}
