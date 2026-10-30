import * as bans from './bans';
import { config } from './config';
import { client, fetchMember, tierOf } from './discord';
import { discordOf, identifiers, tokens } from './fivem';
import { log } from './logs';
import type { Ban } from './store/types';
import { colors, embed } from './ui';
import { formatDuration, now } from './util';

export const lock = { on: false, reason: '' };

interface Deferrals {
    defer(): void;
    update(message: string): void;
    done(reason?: string): void;
}

export function banMessage(ban: Ban): string {
    const lines = [
        `You are banned from ${config.serverName}.`,
        '',
        `Reason: ${ban.reason}`,
        ban.expires == null
            ? 'Expires: never'
            : `Expires: in ${formatDuration(ban.expires - now())} (${new Date(ban.expires * 1000).toUTCString()})`,
        `Ban ID: #${ban.id}`,
    ];
    if (config.appeal) lines.push('', `Appeal at ${config.appeal}`);
    return lines.join('\n');
}

// Returns why the player can't join, or nothing if they can.
export async function gate(ids: string[], toks: string[], name: string): Promise<string | undefined> {
    const match = bans.check(ids, toks);
    if (match) {
        if (match.evading) {
            void log(
                'bans',
                embed(colors.red)
                    .setTitle('Possible ban evasion')
                    .setDescription(
                        `**${name}** tried to connect and matched ban **#${match.ban.id}** (${match.ban.name}) on \`${match.key.split(':')[0]}\`.\n\`${ids.find((i) => i.startsWith('license:')) ?? 'no license'}\``,
                    ),
                { ping: true },
            );
        }
        return banMessage(match.ban);
    }

    if (!lock.on && !config.allowlist.enabled) return;

    const discord = discordOf(ids);

    // if Discord itself is down, don't lock everyone out of an allowlisted server
    if (!client.isReady()) return lock.on ? `${config.serverName} is closed for maintenance. ${lock.reason}`.trim() : undefined;

    if (!discord) return `${config.serverName} needs Discord. Open Discord, then restart FiveM and try again.`;

    const m = await fetchMember(discord);

    if (lock.on && tierOf(m) < 0) return `${config.serverName} is closed for maintenance. ${lock.reason}`.trim();

    if (config.allowlist.enabled) {
        if (!m) return `Join our Discord to play on ${config.serverName}.`;
        if (tierOf(m) < 0 && !config.allowlist.roles.some((r) => m.roles.cache.has(r))) {
            return `You're not on the allowlist for ${config.serverName}.`;
        }
    }
}

on('playerConnecting', (name: string, _setKickReason: unknown, deferrals: Deferrals) => {
    const src = source;
    deferrals.defer();

    setTimeout(async () => {
        try {
            deferrals.update(`Checking your account for ${config.serverName}...`);
            const ids = identifiers(src);

            if (!ids.some((i) => i.startsWith('license:'))) {
                return deferrals.done('No Rockstar license found. Restart FiveM and try again.');
            }

            const reason = await gate(ids, tokens(src), name);
            if (reason) {
                void log('joins', embed(colors.amber).setDescription(`**${name}** was turned away\n${reason.split('\n')[0]}`));
                return deferrals.done(reason);
            }

            deferrals.done();
        } catch (err) {
            console.error(`fivecord: connect check failed for ${name}:`, err);
            deferrals.done();
        }
    }, 0);
});
