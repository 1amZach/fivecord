// For other resources: exports.fivecord:hasRole(source, roleId) and friends.
// The Discord ones use the same names as discordbridge, so scripts written for
// it keep working.

import { readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import * as bans from './bans';
import { banMessage } from './connect';
import { db } from './db';
import { member, roles, sendable, tierName, tierOfDiscord } from './discord';
import { cfx, discordOf, identifiers, pick, tokens } from './fivem';
import { log } from './logs';
import { getNews } from './news';
import { announce } from './restarts';
import * as sessions from './sessions';
import { colors, embed } from './ui';
import { now } from './util';

// Only videos fivecapture saved, and only what Discord will take.
function clipFile(path: unknown): Buffer | null {
    if (typeof path !== 'string' || !path.endsWith('.webm') || GetResourceState('fivecapture') !== 'started') return null;
    const full = resolve(path);
    const rel = relative(resolve(GetResourcePath('fivecapture'), 'captures'), full);
    if (!rel || rel.startsWith('..')) return null;
    try {
        if (statSync(full).size > 10 * 1024 * 1024) return null;
        return readFileSync(full);
    } catch {
        return null;
    }
}

const discordId = (src: unknown) => sessions.bySrc(Number(src))?.discord ?? discordOf(identifiers(Number(src)));

const api: Record<string, (...args: any[]) => unknown> = {
    getDiscordId: discordId,
    getRoles: (src) => roles(discordId(src)),
    hasRole(src, role: string | string[]) {
        const have = roles(discordId(src));
        return (Array.isArray(role) ? role : [role]).some((r) => have.includes(String(r)));
    },
    isMember: (src) => member(discordId(src)) !== undefined,
    getName: (src) => member(discordId(src))?.displayName,
    getAvatar: (src) => member(discordId(src))?.displayAvatarURL({ size: 256 }),
    getMember(src) {
        const m = member(discordId(src));
        return m && { id: m.id, name: m.displayName, username: m.user.username, avatar: m.displayAvatarURL(), roles: roles(m.id), joined: m.joinedTimestamp };
    },

    getTier: (src) => {
        const t = tierOfDiscord(discordId(src));
        return t >= 0 ? tierName(t) : null;
    },
    isStaff: (src) => tierOfDiscord(discordId(src)) >= 0,

    // `image` is an optional data URI, like a screenshot. `clip` is the path of
    // a video fivecapture saved, attached so it plays in Discord.
    log(kind: string, title: string, description?: string, color?: number, image?: string, clip?: string) {
        const e = embed(color ?? colors.brand).setTitle(String(title).slice(0, 256));
        if (description) e.setDescription(String(description).slice(0, 4000));

        const files: AttachmentBuilder[] = [];
        const data = typeof image === 'string' ? image.split(',')[1] : undefined;
        if (data) {
            e.setImage('attachment://screenshot.jpg');
            files.push(new AttachmentBuilder(Buffer.from(data, 'base64'), { name: 'screenshot.jpg' }));
        }
        const video = clipFile(clip);
        if (video) files.push(new AttachmentBuilder(video, { name: 'clip.webm' }));
        void log(kind, e, files.length ? { files } : undefined);
    },

    async send(channel: string, content: string) {
        const c = await sendable(channel);
        await c?.send({ content: String(content).slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});
    },

    announce: (title: string, text: string) => announce(String(title), String(text)),
    getNews: () => getNews() ?? null,

    // for anticheats: exports.fivecord:ban(source, 'Noclip', 0, 'Anticheat'), seconds 0 = permanent
    ban(src: number, reason: string, seconds = 0, by = GetInvokingResource() ?? 'server') {
        const ids = identifiers(src);
        const license = pick(ids, 'license');
        if (!license) return false;
        void bans
            .add({ license, name: GetPlayerName(src), identifiers: ids, tokens: tokens(src), reason, staff: by, duration: seconds > 0 ? seconds : null })
            .then((b) => {
                DropPlayer(src, banMessage(b));
                void log('bans', embed(colors.red).setTitle(`Ban #${b.id}`).setDescription(`**${b.name}** banned by **${by}**\n${reason}`).setFooter({ text: license }), { ping: true });
            });
        return true;
    },

    warn(src: number, reason: string, by = GetInvokingResource() ?? 'server') {
        const license = sessions.bySrc(Number(src))?.license;
        if (!license) return false;
        void db().addEntry('warning', { license, text: reason, staff: by, created: now() });
        emitNet('fivecord:message', src, 'You have been warned', reason);
        void log('bans', embed(colors.amber).setDescription(`**${GetPlayerName(src)}** warned by **${by}**\n${reason}`));
        return true;
    },

    isBanned: (license: string) => bans.activeFor(license) !== undefined,
};

// discordbridge and zdiscord names
api.isRolePresent = api.hasRole!;
api.getRoleNames = (src) => (member(discordId(src))?.roles.cache.map((r) => r.name) ?? []).filter((n) => n !== '@everyone');

export function registerExports() {
    for (const [name, fn] of Object.entries(api)) cfx()(name, fn);
}
