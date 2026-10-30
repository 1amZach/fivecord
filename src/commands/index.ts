import type { Guild, Interaction } from 'discord.js';
import * as reports from '../reports';
import { fail } from '../ui';
import { all } from './list';
import { allowed, commands, find, handlers, needed, viewerTier } from './registry';

commands.push(...all);

handlers.push({
    prefix: 'report',
    async run(i, [action, id]) {
        if (!i.isButton() || !action) return;
        if ((await viewerTier(i)) < 0) return fail(i, 'Only staff can handle reports.');
        await reports.button(i, action, Number(id));
    },
});

export async function deploy(guild: Guild) {
    await guild.commands.set(commands.map((c) => c.data.toJSON()));
}

export async function handle(i: Interaction) {
    try {
        if (i.isAutocomplete()) {
            const cmd = find(i.commandName);
            if (!cmd?.autocomplete) return;
            // don't leak player names to people who can't use the command
            if ((await viewerTier(i as any)) < needed(cmd, i.options.getSubcommand(false) ?? undefined)) return i.respond([]);
            return await cmd.autocomplete(i);
        }

        if (i.isChatInputCommand() || i.isUserContextMenuCommand()) {
            const cmd = find(i.commandName);
            if (!cmd) return;
            const sub = i.isChatInputCommand() ? (i.options.getSubcommand(false) ?? undefined) : undefined;
            if (!(await allowed(i, i.commandName, sub))) return;
            return await cmd.run(i);
        }

        if (i.isMessageComponent() || i.isModalSubmit()) {
            const [prefix, ...args] = i.customId.split(':');
            await handlers.find((h) => h.prefix === prefix)?.run(i, args);
        }
    } catch (err) {
        console.error('fivecord: interaction failed:', err);
        if (i.isRepliable()) await fail(i, 'Something went wrong. The error is in the server console.').catch(() => {});
    }
}
