export interface Tier {
    name: string;
    roles: string[];
}

export interface Config {
    guild: string;
    serverName: string;
    appeal: string;
    tiers: Tier[];
    permissions: Record<string, string>;
    channels: { staffChat: string; reports: string; news: string };
    logs: Record<string, string>;
    alertRole: string;
    allowlist: { enabled: boolean; roles: string[] };
    aces: Record<string, string>;
    commands: { report: string; staffChat: string; reportCooldown: number };
    locations: Record<string, { x: number; y: number; z: number }>;
    presence: string[];
    countChannel: string;
    countFormat: string;
    restarts: { times: string[]; warnings: number[]; command: string };
    weatherCommand: string;
    timeCommand: string;
    weatherTypes: string[];
}

// Lua sends empty tables as {} and arrays as arrays, so accept either
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : Object.values(value ?? {}));
const ids = (value: unknown) => list(value).map(String).filter((id) => /^\d{15,21}$/.test(id));
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const snowflake = (value: unknown) => (/^\d{15,21}$/.test(str(value)) ? str(value) : '');

function record<T>(value: unknown, map: (v: unknown) => T | undefined): Record<string, T> {
    const out: Record<string, T> = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) {
            const mapped = map(v);
            if (mapped !== undefined) out[k] = mapped;
        }
    }
    return out;
}

export function normalize(raw: any = {}): Config {
    const tiers = list(raw.tiers)
        .map((t: any) => ({ name: str(t?.name).toLowerCase(), roles: ids(t?.roles) }))
        .filter((t) => t.name);

    return {
        guild: snowflake(raw.guild),
        serverName: str(raw.serverName, 'FiveM') || 'FiveM',
        appeal: str(raw.appeal),
        tiers: tiers.length ? tiers : [{ name: 'support', roles: [] }, { name: 'mod', roles: [] }, { name: 'admin', roles: [] }, { name: 'owner', roles: [] }],
        permissions: record(raw.permissions, (v) => (typeof v === 'string' ? v.toLowerCase() : undefined)),
        channels: { staffChat: snowflake(raw.channels?.staffChat), reports: snowflake(raw.channels?.reports), news: snowflake(raw.channels?.news) },
        logs: record(raw.logs, (v) => snowflake(v) || undefined),
        alertRole: snowflake(raw.alertRole),
        allowlist: { enabled: raw.allowlist?.enabled === true, roles: ids(raw.allowlist?.roles) },
        aces: record(raw.aces, (v) => str(v) || undefined),
        commands: {
            report: str(raw.commands?.report, 'report'),
            staffChat: str(raw.commands?.staffChat, 'sc'),
            reportCooldown: Number(raw.commands?.reportCooldown ?? 60),
        },
        locations: record(raw.locations, (v: any) =>
            v && [v.x, v.y, v.z].every((n) => typeof n === 'number') ? { x: v.x, y: v.y, z: v.z } : undefined,
        ),
        presence: list(raw.presence).map(String).filter(Boolean),
        countChannel: snowflake(raw.countChannel),
        countFormat: str(raw.countFormat, 'Players: {players}/{max}'),
        restarts: {
            times: list(raw.restarts?.times).map(String).filter((t) => /^\d{1,2}:\d{2}$/.test(t)),
            warnings: list(raw.restarts?.warnings).map(Number).filter((n) => n > 0).sort((a, b) => b - a),
            command: str(raw.restarts?.command, 'quit'),
        },
        weatherCommand: str(raw.weatherCommand, 'weather {type}'),
        timeCommand: str(raw.timeCommand, 'time {hour} {minute}'),
        weatherTypes: list(raw.weatherTypes).map(String),
    };
}

export let config: Config = normalize();

export function setConfig(next: Config) {
    config = next;
}
