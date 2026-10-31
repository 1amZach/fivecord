import { giveitem, money, setgang, setjob } from './economy';
import { help } from './help';
import { ban, bansCommand, freeze, kick, message, note, record, screenshot, unban, warn, warnings } from './moderation';
import { lookup, lookupUser, players } from './players';
import { consoleCommand, resource } from './resources';
import { announce, server, top } from './server';
import { heal, kill, revive, teleport, where } from './world';
import type { Command } from './types';

// in the order /help shows them
export const all: Command[] = [
    help,
    top,
    players,
    lookup,
    lookupUser,
    where,
    revive,
    heal,
    teleport,
    kill,
    message,
    warn,
    warnings,
    note,
    kick,
    freeze,
    screenshot,
    record,
    ban,
    unban,
    bansCommand,
    setjob,
    setgang,
    money,
    giveitem,
    server,
    announce,
    resource,
    consoleCommand,
];
