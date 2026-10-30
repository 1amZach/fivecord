import * as aces from './aces';
import { db } from './db';
import { roles } from './discord';
import { discordOf, identifiers, pick, tokens } from './fivem';
import { log } from './logs';
import { colors, embed } from './ui';
import { formatDuration, now } from './util';

export interface Session {
    src: number;
    name: string;
    license?: string;
    discord?: string;
    joined: number;
    counted: number;
}

export const sessions = new Map<number, Session>();

export const bySrc = (src: number) => sessions.get(src);
export const byDiscord = (id: string) => [...sessions.values()].filter((s) => s.discord === id);
export const byLicense = (license: string) => [...sessions.values()].find((s) => s.license === license);

export function start(src: number, at = now()) {
    const ids = identifiers(src);
    const s: Session = {
        src,
        name: GetPlayerName(src) ?? `Player ${src}`,
        license: pick(ids, 'license'),
        discord: discordOf(ids),
        joined: at,
        counted: at,
    };
    sessions.set(src, s);

    if (s.license) {
        void db()
            .seen({ license: s.license, name: s.name, discord: s.discord, identifiers: ids, tokens: tokens(src) }, at)
            .catch((err) => console.error(`fivecord: could not save player ${s.name}: ${err.message}`));
    }

    aces.sync(src, roles(s.discord));
    return s;
}

export async function count(s: Session, at = now()) {
    const seconds = at - s.counted;
    s.counted = at;
    if (s.license && seconds > 0) await db().addPlaytime(s.license, seconds);
}

export async function countAll() {
    await Promise.all([...sessions.values()].map((s) => count(s).catch(() => {})));
}

export async function end(src: number, reason: string) {
    const s = sessions.get(src);
    if (!s) return;
    sessions.delete(src);
    aces.clear(src);
    await count(s).catch(() => {});

    void log(
        'joins',
        embed(colors.grey).setDescription(
            `**${s.name}** left · \`${src}\`\n${reason || 'Disconnected'} · played ${formatDuration(now() - s.joined)}`,
        ),
    );
    return s;
}

export function joined(s: Session) {
    void log(
        'joins',
        embed(colors.teal).setDescription(
            `**${s.name}** joined · \`${s.src}\`${s.discord ? ` · <@${s.discord}>` : ''}\n\`${s.license ?? 'no license'}\``,
        ),
    );
}
