export const now = () => Math.floor(Date.now() / 1000);

const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };

// "30m", "2h", "1d12h", "2w". Returns seconds, null for permanent, undefined if it makes no sense.
export function parseDuration(text: string): number | null | undefined {
    const t = text.trim().toLowerCase().replace(/\s+/g, '');
    if (['perm', 'permanent', 'forever', 'never', '0'].includes(t)) return null;
    if (!/^(\d+[smhdwy])+$/.test(t)) return undefined;

    let total = 0;
    for (const [, n, unit] of t.matchAll(/(\d+)([smhdwy])/g)) total += Number(n) * units[unit!]!;
    return total > 0 ? total : undefined;
}

export function formatDuration(seconds: number, parts = 2): string {
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
    const out: string[] = [];
    let left = Math.round(seconds);
    for (const [unit, size] of [['y', units.y], ['w', units.w], ['d', units.d], ['h', units.h], ['m', units.m]] as const) {
        const n = Math.floor(left / size!);
        if (n > 0) {
            out.push(`${n}${unit}`);
            left -= n * size!;
        }
        if (out.length === parts) break;
    }
    return out.join(' ');
}

export const ts = (seconds: number, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'R') => `<t:${Math.floor(seconds)}:${style}>`;

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function fill(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}
