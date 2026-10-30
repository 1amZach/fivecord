import { db } from './db';
import type { Ban } from './store/types';
import { now } from './util';

// Every ban is kept in memory, so checking a connecting player never waits on the database.
let all: Ban[] = [];
let index = new Map<string, Ban>();

export const isActive = (b: Ban, at = now()) => b.revokedAt == null && (b.expires == null || b.expires > at);

// IPs are shared by households and change often, they make poor ban keys
const usable = (id: string) => !id.startsWith('ip:');

function rebuild() {
    index = new Map();
    const at = now();
    for (const ban of all) {
        if (!isActive(ban, at)) continue;
        for (const key of [ban.license, ...ban.identifiers.filter(usable), ...ban.tokens]) index.set(key, ban);
    }
}

export async function loadBans() {
    all = await db().bans();
    rebuild();
}

export interface Match {
    ban: Ban;
    // what matched, and whether it was their own account or something shared with it
    key: string;
    evading: boolean;
}

export function check(identifiers: string[], tokens: string[]): Match | undefined {
    const at = now();
    const license = identifiers.find((id) => id.startsWith('license:'));

    for (const key of [...identifiers.filter(usable), ...tokens]) {
        const ban = index.get(key);
        if (ban && isActive(ban, at)) return { ban, key, evading: ban.license !== license };
    }
}

export interface NewBan {
    license: string;
    name: string;
    identifiers: string[];
    tokens: string[];
    reason: string;
    staff: string;
    duration: number | null;
}

export async function add(input: NewBan): Promise<Ban> {
    const created = now();
    const ban: Omit<Ban, 'id'> = {
        license: input.license,
        name: input.name,
        identifiers: input.identifiers.filter(usable),
        tokens: input.tokens,
        reason: input.reason,
        staff: input.staff,
        created,
        expires: input.duration == null ? null : created + input.duration,
        revokedBy: null,
        revokedAt: null,
    };
    const id = await db().addBan(ban);
    const saved = { ...ban, id };
    all.push(saved);
    rebuild();
    return saved;
}

export async function revoke(id: number, by: string): Promise<Ban | undefined> {
    const ban = all.find((b) => b.id === id);
    if (!ban || !isActive(ban)) return undefined;
    const at = now();
    await db().revokeBan(id, by, at);
    ban.revokedBy = by;
    ban.revokedAt = at;
    rebuild();
    return ban;
}

export const get = (id: number) => all.find((b) => b.id === id);

export function forLicense(license: string) {
    return all.filter((b) => b.license === license).sort((a, b) => b.created - a.created);
}

export function list(onlyActive: boolean, search?: string) {
    const at = now();
    const q = search?.toLowerCase();
    return all
        .filter((b) => !onlyActive || isActive(b, at))
        .filter((b) => !q || b.name.toLowerCase().includes(q) || b.license === search || b.reason.toLowerCase().includes(q))
        .sort((a, b) => b.created - a.created);
}

export function activeFor(license: string) {
    return forLicense(license).find((b) => isActive(b));
}
