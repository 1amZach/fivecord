// A pretend FiveM server: natives, events, players and the Lua bridge.
// Import this before anything from src.

const g = globalThis as any;
const handlers = new Map<string, ((...args: any[]) => unknown)[]>();

export const net: { event: string; target: unknown; args: unknown[] }[] = [];
export const commands: string[] = [];
export const dropped: { src: number; reason: string }[] = [];
export const exported = new Map<string, (...args: any[]) => unknown>();
export const files = new Map<string, string>();
export const states: Record<string, string> = { fivecord: 'started', 'screenshot-basic': 'missing', oxmysql: 'missing' };
export const registered = new Map<string, (src: number, args: string[], raw: string) => unknown>();

interface FakePlayer {
    name: string;
    ids: string[];
    tokens: string[];
    ping: number;
    coords: [number, number, number];
}
export const players = new Map<number, FakePlayer>();

export function addPlayer(src: number, name: string, extra: Partial<FakePlayer> = {}) {
    players.set(src, {
        name,
        ids: [`license:${name.toLowerCase()}hash`, `discord:1000000000000000${String(src).padStart(2, "0")}`, `fivem:${src}`, `ip:10.0.0.${src}`],
        tokens: [`3:token-${name.toLowerCase()}`],
        ping: 40 + src,
        coords: [100 + src, 200, 30],
        ...extra,
    });
}

// Lua side of the bridge. Each returns the values Lua would return.
export const lua: Record<string, (...args: any[]) => unknown[]> = {
    config: () => [{}],
    framework: () => ['qb'],
    character: (src: number) => [players.has(src) ? { id: `CID${src}`, name: 'John Doe', job: 'police', jobLabel: 'Police', grade: 2, gradeLabel: 'Sergeant', money: { cash: 500, bank: 12000 } } : null],
    revive: () => [true],
    heal: () => [true],
    jobs: () => [[{ name: 'police', label: 'Police', grades: { 1: { level: 0, label: 'Recruit' }, 2: { level: 1, label: 'Officer' } } }]],
    gangs: () => [{}],
    items: () => [[{ name: 'water', label: 'Water' }]],
    setJob: () => [true],
    setGang: () => [false],
    money: (_src: number, _acc: string, _action: string, amount: number) => [true, amount],
    giveItem: () => [false, 'cannot carry that'],
};

export function fire(event: string, src: number | string | undefined, ...args: unknown[]) {
    g.source = src;
    for (const fn of handlers.get(event) ?? []) fn(...args);
}

g.on = g.onNet = (event: string, fn: (...args: any[]) => unknown) => {
    handlers.set(event, [...(handlers.get(event) ?? []), fn]);
};

g.emit = (event: string, ...args: any[]) => {
    if (event === 'fivecord:bridge') {
        const [id, name, params] = args;
        setImmediate(() => {
            const fn = lua[name];
            if (!fn) return fire('fivecord:bridge:done', undefined, id, false, `no bridge function ${name}`);
            const out = fn(...(params ?? []));
            fire('fivecord:bridge:done', undefined, id, true, ...out);
        });
        return;
    }
    fire(event, g.source, ...args);
};

g.emitNet = (event: string, target: unknown, ...args: unknown[]) => net.push({ event, target, args });

export const wardenAllowed: unknown[][] = [];
// fivecapture: answers with `fakeCapture.result`, or fails with `fakeCapture.error`
export const fakeCapture: { calls: unknown[][]; result: any; error: string | false } = { calls: [], result: null, error: false };
g.exports = new Proxy((name: string, fn: (...args: any[]) => unknown) => exported.set(name, fn), {
    get: (_t, resource: string) => {
        if (resource === 'oxmysql') return undefined;
        if (resource === 'warden') return { allow: (...args: unknown[]) => wardenAllowed.push(args) };
        if (resource === 'fivecapture') {
            const answer = (name: string) => (...args: any[]) => {
                fakeCapture.calls.push([name, ...args.slice(0, -1)]);
                setImmediate(() => args.at(-1)(fakeCapture.error, fakeCapture.result));
            };
            return { screenshot: answer('screenshot'), record: answer('record') };
        }
        return {};
    },
});

g.GetCurrentResourceName = () => 'fivecord';
g.GetResourcePath = (name: string) => `/srv/resources/${name}`;
g.GetInvokingResource = () => 'anticheat';
g.GetConvar = (name: string, fallback: string) => ({ version: 'FXServer-master SERVER v1.0.0.12913 linux', onesync: 'on' })[name] ?? fallback;
g.GetConvarInt = (_name: string, fallback: number) => (_name === 'sv_maxclients' ? 64 : fallback);
g.ExecuteCommand = (cmd: string) => commands.push(cmd);
g.RegisterCommand = (name: string, fn: (src: number, args: string[], raw: string) => unknown) => registered.set(name, fn);
g.RegisterConsoleListener = () => {};
g.CancelEvent = () => {};

g.GetPlayers = () => [...players.keys()].map(String);
g.GetPlayerName = (src: number | string) => players.get(Number(src))?.name ?? null;
g.GetNumPlayerIdentifiers = (src: number) => players.get(Number(src))?.ids.length ?? 0;
g.GetPlayerIdentifier = (src: number, i: number) => players.get(Number(src))?.ids[i];
g.GetNumPlayerTokens = (src: number) => players.get(Number(src))?.tokens.length ?? 0;
g.GetPlayerToken = (src: number, i: number) => players.get(Number(src))?.tokens[i];
g.GetPlayerPing = (src: number) => players.get(Number(src))?.ping ?? 0;
g.GetPlayerPed = (src: number) => (players.has(Number(src)) ? 1000 + Number(src) : 0);
g.GetEntityCoords = (ped: number) => players.get(ped - 1000)?.coords ?? [0, 0, 0];
g.GetEntityHealth = () => 200;
g.DropPlayer = (src: number, reason: string) => {
    dropped.push({ src: Number(src), reason });
    players.delete(Number(src));
};
g.IsPlayerAceAllowed = () => false;

const resourceList = ['fivecord', 'oxmysql', 'qb-core', 'ox_lib', 'old_hud'];
g.GetNumResources = () => resourceList.length;
g.GetResourceByFindIndex = (i: number) => resourceList[i];
g.GetResourceState = (name: string) => states[name] ?? (resourceList.includes(name) ? (name === 'old_hud' ? 'stopped' : 'started') : 'missing');
g.GetResourceMetadata = () => '';
g.StartResource = (name: string) => ((states[name] = 'started'), true);
g.StopResource = (name: string) => ((states[name] = 'stopped'), true);
g.LoadResourceFile = (_res: string, path: string) => files.get(path) ?? null;
g.SaveResourceFile = (_res: string, path: string, data: string) => (files.set(path, data), true);

export const tick = () => new Promise((r) => setImmediate(r));
