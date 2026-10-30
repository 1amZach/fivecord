import { config } from './config';

// principals we've given each player, so we only ever remove our own
const given = new Map<number, Set<string>>();

export function sync(src: number, roles: string[]) {
    const want = new Set<string>();
    for (const role of roles) {
        const principal = config.aces[role];
        if (principal) want.add(principal);
    }

    const had = given.get(src) ?? new Set<string>();
    const added: string[] = [];
    const removed: string[] = [];

    for (const p of want) {
        if (had.has(p)) continue;
        ExecuteCommand(`add_principal player.${src} ${p}`);
        added.push(p);
    }
    for (const p of had) {
        if (want.has(p)) continue;
        ExecuteCommand(`remove_principal player.${src} ${p}`);
        removed.push(p);
    }

    given.set(src, want);
    return { added, removed };
}

export function clear(src: number) {
    for (const p of given.get(src) ?? []) ExecuteCommand(`remove_principal player.${src} ${p}`);
    given.delete(src);
}

export const principals = (src: number) => [...(given.get(src) ?? [])];
