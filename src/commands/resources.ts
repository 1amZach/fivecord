import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { plain, resource as self, resources } from '../fivem';
import { audit } from '../logs';
import { colors, done, embed, fail, footer, pager } from '../ui';
import { clip } from '../util';
import { allowed, handlers } from './registry';
import type { Command } from './types';

const PER_PAGE = 30;
const dot: Record<string, string> = { started: '🟢', starting: '🟡', stopping: '🟡', stopped: '⚫', uninitialized: '⚫' };

function listPage(page: number, filter: string) {
    const all = resources().filter((r) => !filter || r.name.includes(filter));
    const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    const running = all.filter((r) => r.state === 'started').length;

    const e = footer(embed(colors.teal))
        .setTitle(`${running} / ${all.length} resources running`)
        .setDescription(
            all
                .slice(page * PER_PAGE, (page + 1) * PER_PAGE)
                .map((r) => `${dot[r.state] ?? '⚪'} \`${r.name}\`${r.version ? ` ${r.version}` : ''}`)
                .join('\n') || 'Nothing matches.',
        );
    return { embeds: [e], components: [pager('res', page, pages, `:${encodeURIComponent(filter).slice(0, 40)}`)] };
}

export const resource: Command = {
    category: 'Server',
    tier: 'admin',
    tiers: { list: 'support' },
    data: new SlashCommandBuilder()
        .setName('resource')
        .setDescription('Start, stop and restart resources')
        .addSubcommand((s) =>
            s
                .setName('list')
                .setDescription('Every resource and whether it\'s running')
                .addStringOption((o) => o.setName('filter').setDescription('Part of a name')),
        )
        .addSubcommand((s) =>
            s.setName('start').setDescription('Start a resource').addStringOption((o) => o.setName('name').setDescription('Resource').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
            s.setName('stop').setDescription('Stop a resource').addStringOption((o) => o.setName('name').setDescription('Resource').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
            s.setName('restart').setDescription('Restart a resource').addStringOption((o) => o.setName('name').setDescription('Resource').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) => s.setName('refresh').setDescription('Pick up new and changed resources from disk')),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const sub = i.options.getSubcommand();

        if (sub === 'list') return i.reply({ ...listPage(0, i.options.getString('filter') ?? ''), flags: MessageFlags.Ephemeral });

        if (sub === 'refresh') {
            ExecuteCommand('refresh');
            audit(i.user, 'Refreshed resources');
            return done(i, 'Resources refreshed.');
        }

        const name = i.options.getString('name', true);
        const state = GetResourceState(name);
        if (state === 'missing') return fail(i, `There's no resource called \`${name}\`. New one? Run \`/resource refresh\` first.`);

        if (name === self && sub !== 'start') {
            // reply first, this bot is about to go away
            await done(i, sub === 'restart' ? 'Restarting fivecord. Back in a few seconds.' : 'Stopping fivecord. Start it again from the server console.');
            audit(i.user, `${sub === 'restart' ? 'Restarted' : 'Stopped'} resource`, `\`${name}\``);
            setTimeout(() => ExecuteCommand(`${sub === 'restart' ? 'restart' : 'stop'} ${name}`), 1000);
            return;
        }

        let ok = true;
        if (sub === 'start') ok = StartResource(name);
        if (sub === 'stop') ok = StopResource(name);
        if (sub === 'restart') ok = state !== 'started' ? StartResource(name) : StopResource(name) && StartResource(name);

        if (!ok) return fail(i, `Couldn't ${sub} \`${name}\`. Check the server console for errors.`);
        const verb = { start: 'Started', stop: 'Stopped', restart: 'Restarted' }[sub] ?? sub;
        audit(i.user, `${verb} resource`, `\`${name}\``);
        await done(i, `${verb} \`${name}\`.`);
    },
    async autocomplete(i) {
        const q = i.options.getFocused().toLowerCase();
        const sub = i.options.getSubcommand();
        await i.respond(
            resources()
                .filter((r) => r.name.toLowerCase().includes(q))
                .filter((r) => (sub === 'start' ? r.state !== 'started' : sub === 'stop' ? r.state === 'started' : true))
                .slice(0, 25)
                .map((r) => ({ name: `${r.name} · ${r.state}`, value: r.name })),
        );
    },
};

handlers.push({
    prefix: 'res',
    async run(i, [page, filter]) {
        if (!i.isButton() || !(await allowed(i, 'resource', 'list'))) return;
        await i.update(listPage(Number(page), decodeURIComponent(filter ?? '')));
    },
});

// ------------------------------------------------------------------ console

let capture: string[] | undefined;

try {
    RegisterConsoleListener((_channel, message) => {
        capture?.push(plain(message));
    });
} catch {
    // older server builds don't have it, /console still runs commands but can't show output
}

export function runCaptured(command: string, wait = 1500): Promise<string> {
    capture = [];
    ExecuteCommand(command);
    return new Promise((resolve) => {
        setTimeout(() => {
            const out = (capture ?? []).join('');
            capture = undefined;
            resolve(out);
        }, wait);
    });
}

export const consoleCommand: Command = {
    category: 'Server',
    tier: 'owner',
    summary: 'Run any server console command and see what it prints',
    data: new SlashCommandBuilder()
        .setName('console')
        .setDescription('Run a server console command')
        .addStringOption((o) => o.setName('command').setDescription('Exactly what you would type in the console').setRequired(true)),
    async run(i) {
        if (!i.isChatInputCommand()) return;
        const command = i.options.getString('command', true);
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        audit(i.user, 'Ran console command', undefined, `\`${clip(command, 500)}\``, colors.amber);
        const out = (await runCaptured(command)).trim();

        if (!out) return done(i, `Ran \`${clip(command, 200)}\`. It didn't print anything.`);
        if (out.length <= 1900) return i.editReply({ content: `\`${clip(command, 100)}\`\n\`\`\`\n${out}\n\`\`\`` });
        await i.editReply({
            content: `\`${clip(command, 100)}\` printed ${out.split('\n').length} lines:`,
            files: [new AttachmentBuilder(Buffer.from(out), { name: 'output.txt' })],
        });
    },
};
