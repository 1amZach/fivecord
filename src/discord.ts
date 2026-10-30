import {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    type Guild,
    type GuildMember,
    type SendableChannels,
} from 'discord.js';
import { config } from './config';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [] },
});

export const guild = (): Guild | undefined => client.guilds.cache.get(config.guild);

export const member = (id?: string): GuildMember | undefined => (id ? guild()?.members.cache.get(id) : undefined);

export async function fetchMember(id?: string): Promise<GuildMember | undefined> {
    if (!id) return undefined;
    return member(id) ?? guild()?.members.fetch(id).catch(() => undefined);
}

export async function sendable(id?: string): Promise<SendableChannels | undefined> {
    if (!id || !client.isReady()) return undefined;
    const channel = client.channels.cache.get(id) ?? (await client.channels.fetch(id).catch(() => null));
    return channel?.isSendable() ? channel : undefined;
}

// --------------------------------------------------------------- staff tiers

export const tierIndex = (name: string) => config.tiers.findIndex((t) => t.name === name);
export const tierName = (index: number) => config.tiers[index]?.name ?? 'everyone';

// Highest tier the member has a role for. Discord admins get the top tier so
// the bot works before any roles are set up.
export function tierOf(m?: GuildMember | null): number {
    if (!m) return -1;
    if (m.permissions.has(PermissionFlagsBits.Administrator)) return config.tiers.length - 1;

    for (let i = config.tiers.length - 1; i >= 0; i--) {
        if (config.tiers[i]!.roles.some((role) => m.roles.cache.has(role))) return i;
    }
    return -1;
}

export const tierOfDiscord = (id?: string) => tierOf(member(id));

export function roles(id?: string): string[] {
    const m = member(id);
    return m ? [...m.roles.cache.keys()].filter((r) => r !== m.guild.id) : [];
}
