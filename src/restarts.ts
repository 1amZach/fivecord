import { config } from './config';
import { online } from './fivem';
import { log } from './logs';
import * as sessions from './sessions';
import { colors, embed } from './ui';
import { now } from './util';

export interface Planned {
    at: number;
    reason: string;
    by?: string;
    daily: boolean;
    warned: Set<number>;
}

let planned: Planned | undefined;
let skipped = 0;

// Next daily restart after `from`, as unix seconds.
export function nextDaily(times: string[], from = new Date()): number | undefined {
    let best: number | undefined;
    for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        const d = new Date(from);
        d.setHours(h!, m!, 0, 0);
        if (d <= from) d.setDate(d.getDate() + 1);
        const at = Math.floor(d.getTime() / 1000);
        if (best === undefined || at < best) best = at;
    }
    return best;
}

export function announce(title: string, text: string) {
    emitNet('fivecord:announce', -1, title, text);
}

export function upcoming(): Planned | undefined {
    if (planned) return planned;
    const at = nextDaily(config.restarts.times);
    if (at === undefined || at <= skipped) return undefined;
    return (planned = { at, reason: 'Scheduled restart', daily: true, warned: new Set() });
}

export function schedule(minutes: number, reason: string, by: string): Planned {
    planned = { at: now() + Math.round(minutes * 60), reason, by, daily: false, warned: new Set() };
    tick();
    return planned;
}

export function cancel(): Planned | undefined {
    const was = upcoming();
    if (!was) return undefined;
    if (was.daily) skipped = was.at;
    planned = undefined;
    announce('Restart cancelled', 'The server restart has been cancelled.');
    return was;
}

function warn(p: Planned, minutes: number) {
    const when = minutes <= 1 ? 'in under a minute' : `in ${minutes} minutes`;
    announce('Server restart', `The server restarts ${when}. ${p.reason}`.trim());
    void log('staff', embed(colors.amber).setDescription(`Restart ${when} · ${p.reason}`));
}

async function run(p: Planned) {
    planned = undefined;
    skipped = p.at;
    void log('staff', embed(colors.red).setDescription(`Restarting now · ${p.reason}`));
    await sessions.countAll();
    for (const player of online()) DropPlayer(player.src, `${config.serverName} is restarting. ${p.reason}`.trim());
    setTimeout(() => ExecuteCommand(config.restarts.command), 3000);
}

export function tick() {
    const p = upcoming();
    if (!p) return;

    const left = p.at - now();
    if (left <= 0) return void run(p);

    const minutes = Math.ceil(left / 60);
    const due = config.restarts.warnings.filter((w) => w >= minutes && !p.warned.has(w));

    // if several warnings were skipped (restart planned for 3 minutes from now), say it once
    if (due.length) {
        for (const w of config.restarts.warnings) if (w >= minutes) p.warned.add(w);
        warn(p, minutes);
    }
}

export function startClock() {
    setInterval(tick, 15_000);
}
