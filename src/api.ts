// What other resources on the server, like fivepanel, can ask fivecord to do.
//
//   emit('fivecord:api', id, action, args, staff)
//   on('fivecord:api:done', (id, ok, result) => ...)
//
// `staff` is { id: discord id, name, avatar? }. Every action is checked
// against the same tiers and permission overrides as the slash commands.

import type { User } from 'discord.js';
import * as actions from './actions';
import * as bans from './bans';
import * as bridge from './bridge';
import { vehicles } from './commands/players';
import { commands, find, needed } from './commands/registry';
import { config } from './config';
import { lock } from './connect';
import { db } from './db';
import { member, tierName, tierOfDiscord } from './discord';
import { coords, isOnline, online } from './fivem';
import { audit } from './logs';
import * as reports from './reports';
import * as restarts from './restarts';
import * as sessions from './sessions';
import { resolve, type OnlineTarget, type Target } from './targets';
import { fill, now, parseDuration } from './util';

export interface Staff {
    id: string;
    name: string;
    avatar?: string;
}

class Refused extends Error {}

// the actions log and audit through a Discord user, so make one. The caller
// names where it came from, like "Zach (panel)".
const asUser = (s: Staff) =>
    ({ id: s.id, username: s.name, globalName: s.name, displayAvatarURL: () => s.avatar || undefined }) as unknown as User;

// "kick" or "server lock", the same keys Config.permissions uses
function keys() {
    const out: Record<string, number> = {};
    for (const cmd of commands) {
        const json = cmd.data.toJSON() as { name: string; options?: { type: number; name: string }[] };
        out[json.name] = needed(cmd);
        for (const o of json.options ?? []) if (o.type === 1) out[`${json.name} ${o.name}`] = needed(cmd, o.name);
    }
    return out;
}

function need(staff: Staff, key: string) {
    const [name, sub] = key.split(' ');
    const cmd = find(name!);
    if (!cmd) throw new Refused(`Unknown permission ${key}`);
    const tier = needed(cmd, sub);
    if (tier >= 0 && tierOfDiscord(staff.id) < tier) throw new Refused(`You need to be ${tierName(tier)} or higher to do that.`);
}

async function target(raw: unknown): Promise<Target> {
    const t = await resolve(String(raw ?? ''));
    if (!t) throw new Refused('No player matches that.');
    return t;
}

async function onlineTarget(raw: unknown): Promise<OnlineTarget> {
    const t = await target(raw);
    if (t.src == null) throw new Refused(`${t.name} isn't online.`);
    return t as OnlineTarget;
}

const result = (r: actions.Result) => {
    if (!r.ok) throw new Refused(r.text.replace(/\*\*/g, ''));
    return { text: r.text.replace(/\*\*/g, '') };
};

function player(src: number) {
    const s = sessions.bySrc(src);
    const pos = coords(src);
    return {
        src,
        name: s?.name ?? GetPlayerName(src),
        license: s?.license,
        discord: s?.discord,
        joined: s?.joined,
        ping: GetPlayerPing(src),
        pos,
        frozen: actions.isFrozen(src),
        staff: tierOfDiscord(s?.discord) >= 0 ? tierName(tierOfDiscord(s?.discord)) : null,
    };
}

const handlers: Record<string, (staff: Staff, ...args: any[]) => Promise<unknown> | unknown> = {
    access(staff) {
        const tier = tierOfDiscord(staff.id);
        const m = member(staff.id);
        return {
            tier,
            tierName: tier >= 0 ? tierName(tier) : null,
            tiers: config.tiers.map((t) => t.name),
            needs: keys(),
            name: m?.displayName,
            serverName: config.serverName,
        };
    },

    players(staff) {
        need(staff, 'players');
        return online().map((p) => player(p.src));
    },

    async search(staff, q: string) {
        need(staff, 'lookup');
        return (await db().search(String(q), 25)).map((p) => ({ license: p.license, name: p.name, discord: p.discord, lastSeen: p.lastSeen, online: Boolean(sessions.byLicense(p.license)) }));
    },

    async profile(staff, raw: string) {
        need(staff, 'lookup');
        const t = await target(raw);
        const [record, warnings, notes] = t.license
            ? await Promise.all([db().player(t.license), db().entries('warning', t.license), db().entries('note', t.license)])
            : [undefined, [], []];

        let character, cars;
        if (t.src != null) {
            const [char, fw] = await Promise.all([bridge.character(t.src).catch(() => undefined), bridge.framework().catch(() => 'none' as const)]);
            character = char;
            cars = char ? await vehicles(char, fw) : undefined;
        }

        const live = t.src != null ? sessions.bySrc(t.src) : undefined;
        return {
            ...t,
            online: t.src != null ? player(t.src) : null,
            record: record && { ...record, playtime: record.playtime + (live ? now() - live.counted : 0), tokens: undefined },
            identifiers: record?.identifiers.filter((id) => !id.startsWith('ip:')) ?? [],
            character,
            vehicles: cars,
            warnings,
            notes,
            bans: t.license ? bans.forLicense(t.license).map((b) => ({ ...b, active: bans.isActive(b), tokens: undefined, identifiers: undefined })) : [],
        };
    },

    async act(staff, action: string, raw: string, ...args: any[]) {
        const by = asUser(staff);
        switch (action) {
            case 'message': need(staff, 'message'); return result(await actions.message(by, await onlineTarget(raw), String(args[0])));
            case 'warn': need(staff, 'warn'); return result(await actions.warn(by, await target(raw), String(args[0])));
            case 'kick': need(staff, 'kick'); return result(await actions.kick(by, await onlineTarget(raw), String(args[0])));
            case 'freeze': need(staff, 'freeze'); return result(await actions.freeze(by, await onlineTarget(raw), args[0] ?? undefined));
            case 'revive': need(staff, 'revive'); return result(await actions.revive(by, await onlineTarget(raw)));
            case 'heal': need(staff, 'heal'); return result(await actions.heal(by, await onlineTarget(raw)));
            case 'kill': need(staff, 'kill'); return result(await actions.kill(by, await onlineTarget(raw)));
            case 'teleport': {
                need(staff, 'teleport');
                const t = await onlineTarget(raw);
                const [x, y, z] = args.map(Number);
                if (![x, y, z].every(Number.isFinite)) throw new Refused('Those coords look wrong.');
                return result(await actions.teleport(by, t, x!, y!, z!, String(args[3] ?? `${x!.toFixed(0)}, ${y!.toFixed(0)}`)));
            }
            case 'bring': {
                need(staff, 'teleport');
                const [t, to] = await Promise.all([onlineTarget(raw), onlineTarget(args[0])]);
                const [x, y, z] = coords(to.src) ?? [];
                if (x == null) throw new Refused(`Couldn't find where ${to.name} is.`);
                return result(await actions.teleport(by, t, x, y!, z!, to.name));
            }
            case 'screenshot': {
                need(staff, 'screenshot');
                const r = await actions.screenshot(by, await onlineTarget(raw));
                const file = r.files?.[0]?.attachment;
                if (!r.ok || !Buffer.isBuffer(file)) throw new Refused(r.text);
                return { text: r.text, image: `data:image/jpeg;base64,${file.toString('base64')}` };
            }
            case 'ban': {
                need(staff, 'ban');
                const duration = parseDuration(String(args[0] ?? ''));
                if (duration === undefined) throw new Refused('That ban length doesn\'t make sense. Try 3d, 12h or perm.');
                return result(await actions.ban(by, await target(raw), duration, String(args[1])));
            }
            case 'note': {
                need(staff, 'note add');
                const t = await target(raw);
                if (!t.license) throw new Refused(`${t.name} has no license on record.`);
                const id = await db().addEntry('note', { license: t.license, text: String(args[0]).slice(0, 1000), staff: staffLabel(staff), created: now() });
                audit(by, 'Added a note to', t.name, String(args[0]));
                return { text: `Added note #${id}.` };
            }
        }
        throw new Refused(`Unknown action ${action}`);
    },

    async unban(staff, id: number, reason: string) {
        need(staff, 'unban');
        return result(await actions.unban(asUser(staff), Number(id), String(reason || 'Lifted from the panel')));
    },

    async removeEntry(staff, kind: 'warning' | 'note', id: number) {
        need(staff, kind === 'note' ? 'note remove' : 'warnings remove');
        const e = await db().removeEntry(kind, Number(id));
        if (!e) throw new Refused(`That ${kind} doesn't exist.`);
        audit(asUser(staff), `Removed a ${kind} from`, e.license, e.text);
        return { text: `Removed ${kind} #${e.id}.` };
    },

    bans(staff, active: boolean, search?: string) {
        need(staff, 'bans');
        return bans
            .list(Boolean(active), search || undefined)
            .slice(0, 200)
            .map((b) => ({ ...b, active: bans.isActive(b), identifiers: undefined, tokens: undefined }));
    },

    reports(staff) {
        need(staff, 'players');
        return reports.list().map((r) => ({ ...r, online: isOnline(r.src) }));
    },

    async report(staff, action: string, id: number, text?: string) {
        need(staff, 'players');
        const r = reports.byId(Number(id));
        if (!r) throw new Refused('That report is already closed.');
        const name = staffLabel(staff);
        if (action === 'reply') await reports.reply(r, name, String(text ?? '').slice(0, 1000));
        else if (action === 'claim') await reports.claim(r, name);
        else if (action === 'close') await reports.close(r, name, text || undefined);
        else throw new Refused(`Unknown report action ${action}`);
        audit(asUser(staff), `${action === 'reply' ? 'Replied to' : action === 'claim' ? 'Claimed' : 'Closed'} report`, `#${r.id}`, text);
        return { text: 'Done.' };
    },

    status(staff) {
        need(staff, 'server status');
        const next = restarts.upcoming();
        return {
            lock: { ...lock },
            restart: next && { at: next.at, reason: next.reason, daily: next.daily, by: next.by },
            weatherTypes: config.weatherTypes,
            reports: reports.openCount(),
        };
    },

    server(staff, action: string, ...args: any[]) {
        const by = asUser(staff);
        switch (action) {
            case 'lock':
                need(staff, 'server lock');
                lock.on = true;
                lock.reason = String(args[0] || 'Maintenance');
                audit(by, 'Locked the server', undefined, lock.reason, 0xf5a524);
                return { text: 'Server locked. Only staff can join.' };
            case 'unlock':
                need(staff, 'server unlock');
                lock.on = false;
                lock.reason = '';
                audit(by, 'Unlocked the server');
                return { text: 'Server unlocked.' };
            case 'restart': {
                need(staff, 'server restart');
                const minutes = Math.max(0, Math.min(1440, Number(args[0]) || 0));
                const p = restarts.schedule(minutes, String(args[1] ?? ''), staffLabel(staff));
                audit(by, 'Scheduled a restart', undefined, `<t:${p.at}:R> ${p.reason}`, 0xf5a524);
                return { text: minutes ? `Restarting in ${minutes} minutes.` : 'Restarting now.' };
            }
            case 'cancelRestart': {
                need(staff, 'server cancelrestart');
                if (!restarts.cancel()) throw new Refused('No restart is planned.');
                audit(by, 'Cancelled a restart');
                return { text: 'Restart cancelled.' };
            }
            case 'kickall': {
                need(staff, 'server kickall');
                const list = online();
                for (const p of list) DropPlayer(p.src, String(args[0] || 'Kicked by staff'));
                audit(by, 'Kicked everyone', `${list.length} players`, String(args[0]), 0xe5484d);
                return { text: `Kicked ${list.length} players.` };
            }
            case 'announce':
                need(staff, 'announce');
                restarts.announce(String(args[0]).slice(0, 100), String(args[1]).slice(0, 500));
                audit(by, 'Announced', String(args[0]), String(args[1]));
                return { text: 'Announced.' };
            case 'weather': {
                need(staff, 'server weather');
                const type = String(args[0]).toUpperCase();
                ExecuteCommand(fill(config.weatherCommand, { type, weather: type }));
                audit(by, 'Changed the weather', undefined, type);
                return { text: `Weather set to ${type.toLowerCase()}.` };
            }
            case 'time': {
                need(staff, 'server time');
                const hour = Math.max(0, Math.min(23, Number(args[0]) || 0));
                const minute = Math.max(0, Math.min(59, Number(args[1]) || 0));
                ExecuteCommand(fill(config.timeCommand, { hour, minute }));
                audit(by, 'Changed the time', undefined, `${hour}:${String(minute).padStart(2, '0')}`);
                return { text: `Time set to ${hour}:${String(minute).padStart(2, '0')}.` };
            }
        }
        throw new Refused(`Unknown server action ${action}`);
    },
};

const staffLabel = (s: Staff) => s.name;

export async function run(action: string, args: unknown[], staff: Staff) {
    const fn = handlers[action];
    if (!fn) throw new Refused(`Unknown action ${action}`);
    if (!staff || typeof staff.id !== 'string') throw new Refused('No staff member given.');
    return fn(staff, ...(Array.isArray(args) ? args : []));
}

export function registerApi() {
    on('fivecord:api', async (id: unknown, action: string, args: unknown[], staff: Staff) => {
        try {
            emit('fivecord:api:done', id, true, await run(action, args, staff));
        } catch (err) {
            const message = err instanceof Refused ? err.message : `Something went wrong: ${(err as Error).message}`;
            if (!(err instanceof Refused)) console.error(`fivecord: api ${action} failed: ${(err as Error).stack}`);
            emit('fivecord:api:done', id, false, message);
        }
    });
}
