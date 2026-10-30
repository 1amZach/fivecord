import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import * as bridge from '../bridge';
import { audit } from '../logs';
import { describe, needOnline, suggest } from '../targets';
import { colors, done, fail } from '../ui';
import { money as cash } from '../util';
import type { Command } from './types';

// job, gang and item lists barely change, no need to ask the framework on every keystroke
function cached<T>(load: () => Promise<T[]>) {
    let value: T[] = [];
    let at = 0;
    return async () => {
        if (Date.now() - at > 60_000) {
            value = await load().catch(() => value);
            at = Date.now();
        }
        return value;
    };
}

const jobs = cached(bridge.jobs);
const gangs = cached(bridge.gangs);
const items = cached(bridge.items);

async function groupComplete(i: AutocompleteInteraction, list: () => Promise<bridge.Group[]>, key: string) {
    const focused = i.options.getFocused(true);
    const q = focused.value.toLowerCase();
    const groups = await list();

    if (focused.name === key) {
        return i.respond(
            groups
                .filter((g) => g.name.includes(q) || g.label.toLowerCase().includes(q))
                .slice(0, 25)
                .map((g) => ({ name: `${g.label} (${g.name})`.slice(0, 100), value: g.name })),
        );
    }

    if (focused.name === 'grade') {
        const g = groups.find((x) => x.name === i.options.getString(key));
        return i.respond((g?.grades ?? []).slice(0, 25).map((gr) => ({ name: `${gr.level} · ${gr.label}`.slice(0, 100), value: gr.level })));
    }

    return suggest(i, false);
}

function groupCommand(kind: 'job' | 'gang'): Command {
    const list = kind === 'job' ? jobs : gangs;
    return {
        category: 'Economy',
        tier: 'admin',
        data: new SlashCommandBuilder()
            .setName(`set${kind}`)
            .setDescription(`Change a player's ${kind}`)
            .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName(kind).setDescription(`The ${kind}`).setRequired(true).setAutocomplete(true))
            .addIntegerOption((o) => o.setName('grade').setDescription('Grade, 0 is the lowest').setMinValue(0).setAutocomplete(true)),
        async run(i) {
            if (!i.isChatInputCommand()) return;
            const t = await needOnline(i, i.options.getString('player', true));
            if (!t) return;

            const name = i.options.getString(kind, true);
            const grade = i.options.getInteger('grade') ?? 0;
            const ok = kind === 'job' ? await bridge.setJob(t.src, name, grade) : await bridge.setGang(t.src, name, grade);
            if (!ok) return fail(i, `Couldn't set that ${kind}. Check the ${kind} and grade exist.`);

            const g = (await list()).find((x) => x.name === name);
            const label = `${g?.label ?? name} · ${g?.grades.find((x) => x.level === grade)?.label ?? `grade ${grade}`}`;
            audit(i.user, `Set ${kind}`, describe(t), label);
            await done(i, `${describe(t)} is now **${label}**.`);
        },
        autocomplete: (i) => groupComplete(i, list, kind),
    };
}

export const setjob = groupCommand('job');
export const setgang = groupCommand('gang');

export const money: Command = {
    category: 'Economy',
    tier: 'admin',
    data: new SlashCommandBuilder()
        .setName('money')
        .setDescription("Add, take or set a player's money")
        .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
            o
                .setName('action')
                .setDescription('What to do')
                .setRequired(true)
                .addChoices({ name: 'give', value: 'add' }, { name: 'take', value: 'remove' }, { name: 'set to', value: 'set' }),
        )
        .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(0).setMaxValue(1_000_000_000))
        .addStringOption((o) => o.setName('account').setDescription('cash, bank, ...').setAutocomplete(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (!t) return;

        const action = i.options.getString('action', true) as 'add' | 'remove' | 'set';
        const amount = i.options.getInteger('amount', true);
        const account = i.options.getString('account') ?? 'bank';

        const r = await bridge.money(t.src, account, action, amount);
        if (!r.ok) return fail(i, `Couldn't change **${account}**. Not enough money, or that account doesn't exist.`);

        const verb = { add: 'Gave', remove: 'Took', set: 'Set' }[action];
        const text = action === 'set' ? `${account} to ${cash(amount)}` : `${cash(amount)} ${action === 'add' ? 'to' : 'from'} ${account}`;
        audit(i.user, `${verb} money`, describe(t), `${text} · now ${cash(r.balance)}`, colors.amber);
        await done(i, `${verb} ${text} for ${describe(t)}. Balance: **${cash(r.balance)}**.`);
    },
    async autocomplete(i) {
        if (i.options.getFocused(true).name !== 'account') return suggest(i, false);

        let accounts = ['cash', 'bank'];
        const raw = i.options.getString('player');
        const src = raw?.startsWith('@') ? Number(raw.slice(1)) : undefined;
        if (src) {
            const char = await bridge.character(src).catch(() => undefined);
            if (char) accounts = Object.keys(char.money);
        }
        const q = i.options.getFocused().toLowerCase();
        await i.respond(accounts.filter((a) => a.includes(q)).slice(0, 25).map((a) => ({ name: a, value: a })));
    },
};

export const giveitem: Command = {
    category: 'Economy',
    tier: 'admin',
    data: new SlashCommandBuilder()
        .setName('giveitem')
        .setDescription('Put an item in a player\'s inventory')
        .addStringOption((o) => o.setName('player').setDescription('Who').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('count').setDescription('How many').setMinValue(1).setMaxValue(10_000)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const t = await needOnline(i, i.options.getString('player', true));
        if (!t) return;
        const item = i.options.getString('item', true);
        const count = i.options.getInteger('count') ?? 1;

        const r = await bridge.giveItem(t.src, item, count);
        if (!r.ok) return fail(i, `Couldn't give **${item}**${r.error ? `: ${r.error}` : ''}.`);

        const label = (await items()).find((x) => x.name === item)?.label ?? item;
        audit(i.user, 'Gave item', describe(t), `${count}x ${label}`);
        await done(i, `Gave ${count}x **${label}** to ${describe(t)}.`);
    },
    async autocomplete(i) {
        if (i.options.getFocused(true).name !== 'item') return suggest(i, false);
        const q = i.options.getFocused().toLowerCase();
        await i.respond(
            (await items())
                .filter((x) => x.name.includes(q) || x.label.toLowerCase().includes(q))
                .slice(0, 25)
                .map((x) => ({ name: `${x.label} (${x.name})`.slice(0, 100), value: x.name })),
        );
    },
};
