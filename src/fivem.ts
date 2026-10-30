export const resource = GetCurrentResourceName();

// FiveM's exports. Always reach it through globalThis: inside a bundle a bare
// `exports` is the module's own exports object, not FiveM's.
export const cfx = (): any => (globalThis as any).exports;

export interface Online {
    src: number;
    name: string;
    license?: string;
    discord?: string;
    ping: number;
}

export function identifiers(src: Src): string[] {
    const out: string[] = [];
    const count = GetNumPlayerIdentifiers(src);
    for (let i = 0; i < count; i++) out.push(GetPlayerIdentifier(src, i));
    return out;
}

export function tokens(src: Src): string[] {
    const out: string[] = [];
    const count = GetNumPlayerTokens(src);
    for (let i = 0; i < count; i++) out.push(GetPlayerToken(src, i));
    return out;
}

export function pick(ids: string[], kind: string): string | undefined {
    const prefix = `${kind}:`;
    return ids.find((id) => id.startsWith(prefix));
}

export function discordOf(ids: string[]): string | undefined {
    return pick(ids, 'discord')?.slice(8);
}

export function online(): Online[] {
    return GetPlayers()
        .map((s) => {
            const src = Number(s);
            const ids = identifiers(src);
            return {
                src,
                name: GetPlayerName(src) ?? `Player ${src}`,
                license: pick(ids, 'license'),
                discord: discordOf(ids),
                ping: GetPlayerPing(src),
            };
        })
        .sort((a, b) => a.src - b.src);
}

export function isOnline(src: number): boolean {
    return GetPlayers().includes(String(src));
}

export function maxPlayers(): number {
    return GetConvarInt('sv_maxclients', 48);
}

export function coords(src: number): [number, number, number] | undefined {
    const ped = GetPlayerPed(src);
    if (!ped) return undefined;
    const [x = 0, y = 0, z = 0] = GetEntityCoords(ped);
    return [x, y, z];
}

export interface ResourceInfo {
    name: string;
    state: string;
    version?: string;
}

export function resources(): ResourceInfo[] {
    const out: ResourceInfo[] = [];
    const count = GetNumResources();
    for (let i = 0; i < count; i++) {
        const name = GetResourceByFindIndex(i);
        if (!name || name === '_cfx_internal') continue;
        out.push({ name, state: GetResourceState(name), version: GetResourceMetadata(name, 'version', 0) || undefined });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function started(name: string): boolean {
    return GetResourceState(name) === 'started';
}

// console output is coloured with ^1..^9 and ANSI codes, Discord wants neither
export function plain(text: string): string {
    return text.replace(/\^[0-9]/g, '').replace(/\x1b\[[0-9;]*m/g, '');
}
