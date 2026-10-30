import type { RepliableInteraction } from 'discord.js';
import { config } from '../config';
import { fetchMember, tierIndex, tierName, tierOf } from '../discord';
import { fail } from '../ui';
import type { Command, Handler } from './types';

export const commands: Command[] = [];
export const handlers: Handler[] = [];

export const find = (name: string) => commands.find((c) => c.data.name === name);

// Tier index needed for a command, -1 meaning everyone.
export function needed(cmd: Command, sub?: string): number {
    const name = cmd.data.name;
    const override = (sub && config.permissions[`${name} ${sub}`]) || config.permissions[name];
    const tier = override ?? (sub && cmd.tiers && sub in cmd.tiers ? cmd.tiers[sub] : cmd.tier);
    if (tier == null || tier === 'everyone') return -1;

    const index = tierIndex(tier);
    // a tier the config doesn't have: only the top tier can use it
    return index >= 0 ? index : config.tiers.length - 1;
}

export async function viewerTier(i: RepliableInteraction) {
    return tierOf(await fetchMember(i.user.id));
}

export async function allowed(i: RepliableInteraction, command: string, sub?: string): Promise<boolean> {
    const cmd = find(command);
    if (!cmd) return false;
    const need = needed(cmd, sub);
    if (need < 0 || (await viewerTier(i)) >= need) return true;
    await fail(i, `You need to be **${tierName(need)}** or higher to do that.`);
    return false;
}
