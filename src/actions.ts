// What staff can do to a player. Slash commands and buttons both end up here,
// so every action is checked, logged and worded the same way.

import { AttachmentBuilder, type User } from 'discord.js';
import * as bans from './bans';
import * as bridge from './bridge';
import { banMessage } from './connect';
import { db } from './db';
import { cfx, identifiers, tokens } from './fivem';
import { audit, log } from './logs';
import type { OnlineTarget, Target } from './targets';
import { describe } from './targets';
import { colors, embed, staffName } from './ui';
import { formatDuration, now } from './util';

export interface Result {
    ok: boolean;
    text: string;
    files?: AttachmentBuilder[];
}

const ok = (text: string, files?: AttachmentBuilder[]): Result => ({ ok: true, text, files });
const no = (text: string): Result => ({ ok: false, text });

const notify = (src: number, title: string, description: string, type = 'inform') =>
    emitNet('fivecord:notify', src, { title, description, type, duration: 8000 });

export async function message(by: User, t: OnlineTarget, text: string) {
    emitNet('fivecord:message', t.src, `Message from ${staffName(by)}`, text);
    audit(by, 'Messaged', describe(t), text);
    return ok(`Sent to ${describe(t)}.`);
}

export async function warn(by: User, t: Target, reason: string) {
    if (!t.license) return no(`${t.name} has no license on record.`);
    await db().addEntry('warning', { license: t.license, text: reason, staff: staffName(by), created: now() });
    const total = (await db().entries('warning', t.license)).length;

    if (t.src != null) emitNet('fivecord:message', t.src, 'You have been warned', `${reason}\n\nWarning ${total} on your record.`);

    audit(by, 'Warned', describe(t), reason, colors.amber);
    void log('bans', embed(colors.amber).setDescription(`**${t.name}** warned by **${staffName(by)}** · ${total} total\n${reason}`));
    return ok(`Warned ${describe(t)}. They have **${total}** warning${total === 1 ? '' : 's'}.`);
}

export async function kick(by: User, t: OnlineTarget, reason: string) {
    DropPlayer(t.src, `Kicked by staff: ${reason}`);
    audit(by, 'Kicked', describe(t), reason, colors.amber);
    return ok(`Kicked ${describe(t)}.`);
}

export async function ban(by: User, t: Target, duration: number | null, reason: string) {
    if (!t.license) return no(`${t.name} has no license on record, so they can't be banned.`);
    if (bans.activeFor(t.license)) return no(`${t.name} is already banned. Use \`/unban\` first to change it.`);

    let ids: string[] = [t.license];
    let toks: string[] = [];
    if (t.src != null) {
        ids = identifiers(t.src);
        toks = tokens(t.src);
    } else {
        const seen = await db().player(t.license);
        if (seen) {
            ids = seen.identifiers;
            toks = seen.tokens;
        }
    }

    const b = await bans.add({ license: t.license, name: t.name, identifiers: ids, tokens: toks, reason, staff: staffName(by), duration });
    if (t.src != null) DropPlayer(t.src, banMessage(b));

    emit('fivecord:playerBanned', t.src ?? -1, t.license, b);
    const length = duration == null ? 'permanently' : `for ${formatDuration(duration)}`;
    audit(by, 'Banned', describe(t), `${length} · ${reason}`, colors.red);
    void log(
        'bans',
        embed(colors.red)
            .setTitle(`Ban #${b.id}`)
            .setDescription(`**${t.name}** banned ${length} by **${staffName(by)}**\n${reason}`)
            .setFooter({ text: t.license }),
    );
    return ok(`Banned ${describe(t)} ${length}. Ban **#${b.id}**.`);
}

export async function unban(by: User, id: number, reason: string) {
    const b = await bans.revoke(id, staffName(by));
    if (!b) return no(`Ban #${id} doesn't exist or isn't active.`);
    audit(by, 'Unbanned', `#${id} ${b.name}`, reason, colors.green);
    void log('bans', embed(colors.green).setDescription(`Ban **#${id}** on **${b.name}** lifted by **${staffName(by)}**\n${reason}`));
    return ok(`Lifted ban **#${id}** on **${b.name}**.`);
}

const frozen = new Set<number>();
on('playerDropped', () => frozen.delete(Number(source)));

export async function freeze(by: User, t: OnlineTarget, state = !frozen.has(t.src)) {
    if (state) frozen.add(t.src);
    else frozen.delete(t.src);
    emitNet('fivecord:freeze', t.src, state);
    audit(by, state ? 'Froze' : 'Unfroze', describe(t));
    return ok(`${state ? 'Froze' : 'Unfroze'} ${describe(t)}.`);
}

export const isFrozen = (src: number) => frozen.has(src);

export async function revive(by: User, t: OnlineTarget) {
    await bridge.revive(t.src);
    notify(t.src, 'Revived', 'Staff revived you.', 'success');
    audit(by, 'Revived', describe(t));
    return ok(`Revived ${describe(t)}.`);
}

export async function heal(by: User, t: OnlineTarget) {
    await bridge.heal(t.src);
    audit(by, 'Healed', describe(t));
    return ok(`Healed ${describe(t)}.`);
}

export async function kill(by: User, t: OnlineTarget) {
    emitNet('fivecord:kill', t.src);
    audit(by, 'Killed', describe(t), undefined, colors.red);
    return ok(`Killed ${describe(t)}.`);
}

export async function teleport(by: User, t: OnlineTarget, x: number, y: number, z: number, where: string) {
    // Tell the anticheat this one is on purpose.
    if (GetResourceState('warden') === 'started') cfx().warden.allow(t.src, 'teleport', 10);
    emitNet('fivecord:teleport', t.src, x, y, z);
    audit(by, 'Teleported', describe(t), `to ${where}`);
    return ok(`Teleported ${describe(t)} to ${where}.`);
}

export function screenshot(by: User, t: OnlineTarget): Promise<Result> {
    if (GetResourceState('screenshot-basic') !== 'started') {
        return Promise.resolve(no('Screenshots need the `screenshot-basic` resource.'));
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(no(`${t.name} didn't send a screenshot back in time.`)), 20_000);

        cfx()['screenshot-basic'].requestClientScreenshot(t.src, { encoding: 'jpg', quality: 0.85 }, (err: unknown, data: string) => {
            clearTimeout(timer);
            if (err || typeof data !== 'string') return resolve(no(`Screenshot failed: ${String(err ?? 'no data')}`));

            const file = new AttachmentBuilder(Buffer.from(data.split(',')[1] ?? '', 'base64'), { name: `screenshot-${t.src}.jpg` });
            audit(by, 'Took a screenshot of', describe(t));
            resolve(ok(`Screenshot of ${describe(t)}.`, [file]));
        });
    });
}
