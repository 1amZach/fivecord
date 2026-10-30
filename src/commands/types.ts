import type {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    RESTPostAPIApplicationCommandsJSONBody,
    UserContextMenuCommandInteraction,
} from 'discord.js';

export type Category = 'General' | 'Players' | 'Moderation' | 'Economy' | 'Server';

export interface Command {
    data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
    category: Category;
    // lowest staff tier that can use it, null for everyone
    tier: string | null;
    // per subcommand, when they differ
    tiers?: Record<string, string | null>;
    // shown in /help, defaults to the command description
    summary?: string;
    run(i: ChatInputCommandInteraction | UserContextMenuCommandInteraction): Promise<unknown>;
    autocomplete?(i: AutocompleteInteraction): Promise<unknown>;
}

// Buttons, menus and modals, matched on the part of the custom id before the first colon.
export interface Handler {
    prefix: string;
    run(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[]): Promise<unknown>;
}
