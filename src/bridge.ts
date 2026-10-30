// Calls into server/bridge.lua. Lua runs each call in its own thread, so
// framework functions are free to wait on the database.

type Settle = (ok: boolean, a: unknown, b: unknown) => void;

let next = 0;
const pending = new Map<number, Settle>();

on('fivecord:bridge:done', (id: number, ok: boolean, a: unknown, b: unknown) => {
    pending.get(id)?.(ok, a, b);
    pending.delete(id);
});

export function call<A = unknown, B = unknown>(name: string, ...args: unknown[]): Promise<[A, B]> {
    const id = ++next;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`bridge ${name} timed out`));
        }, 10_000);

        pending.set(id, (ok, a, b) => {
            clearTimeout(timer);
            if (ok) resolve([a as A, b as B]);
            else reject(new Error(String(a)));
        });

        emit('fivecord:bridge', id, name, args);
    });
}

export interface Character {
    id: string;
    name: string;
    job: string;
    jobLabel: string;
    grade: number;
    gradeLabel: string;
    gang?: string;
    gangLabel?: string;
    money: Record<string, number>;
}

export interface Group {
    name: string;
    label: string;
    grades: { level: number; label: string }[];
}

export type Framework = 'qbx' | 'qb' | 'esx' | 'none';

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value : Object.values(value ?? {})) as T[];

export const framework = async () => (await call<Framework>('framework'))[0];
export const character = async (src: number) => (await call<Character | null>('character', src))[0] ?? undefined;
export const jobs = async () => list<Group>((await call('jobs'))[0]).map((g) => ({ ...g, grades: list<Group['grades'][number]>(g.grades) }));
export const gangs = async () => list<Group>((await call('gangs'))[0]).map((g) => ({ ...g, grades: list<Group['grades'][number]>(g.grades) }));
export const items = async () => list<{ name: string; label: string }>((await call('items'))[0]);

export async function setJob(src: number, job: string, grade: number) {
    return Boolean((await call('setJob', src, job, grade))[0]);
}

export async function setGang(src: number, gang: string, grade: number) {
    return Boolean((await call('setGang', src, gang, grade))[0]);
}

export async function money(src: number, account: string, action: 'add' | 'remove' | 'set', amount: number) {
    const [ok, balance] = await call<boolean, number>('money', src, account, action, amount);
    return { ok: Boolean(ok), balance };
}

export async function giveItem(src: number, item: string, count: number) {
    const [ok, err] = await call<boolean, unknown>('giveItem', src, item, count);
    return { ok: Boolean(ok), error: typeof err === 'string' ? err : undefined };
}

export const revive = (src: number) => call('revive', src);
export const heal = (src: number) => call('heal', src);
