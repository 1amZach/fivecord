import { addPlayer, dropped, exported, fakeCapture, net, players, registered, states, tick, wardenAllowed } from './env';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as act from '../src/actions';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { handle } from '../src/commands';
import { commands, handlers, needed } from '../src/commands/registry';
import * as bans from '../src/bans';
import { normalize, setConfig } from '../src/config';
import { db, openStore } from '../src/db';
import { registerExports } from '../src/exports';
import * as game from '../src/game';
import * as sessions from '../src/sessions';

const user = { id: '42', username: 'zach', globalName: 'Zach', displayAvatarURL: () => 'https://cdn/avatar.png' };

function interaction(name: string, opts: Record<string, unknown> = {}, sub?: string) {
    const replies: any[] = [];
    const i: any = {
        commandName: name,
        customId: '',
        user,
        deferred: false,
        replied: false,
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        isUserContextMenuCommand: () => false,
        isMessageComponent: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        isStringSelectMenu: () => false,
        isButton: () => false,
        options: {
            getString: (k: string, required?: boolean) => (opts[k] as string) ?? (required ? assert.fail(`missing ${k}`) : null),
            getInteger: (k: string) => (opts[k] as number) ?? null,
            getBoolean: (k: string) => (opts[k] as boolean) ?? null,
            getSubcommand: (required = true) => sub ?? (required ? assert.fail('no subcommand') : null),
        },
        reply: async (p: unknown) => ((i.replied = true), replies.push(p)),
        editReply: async (p: unknown) => replies.push(p),
        deferReply: async () => (i.deferred = true),
        update: async (p: unknown) => replies.push(p),
        replies,
    };
    return i;
}

const text = (payload: any) => payload.embeds?.[0]?.data?.description ?? payload.content ?? '';

before(async () => {
    setConfig(normalize({ serverName: 'Test RP' }));
    await openStore();
    await bans.loadBans();
    registerExports();
});

describe('/help', () => {
    test('credits IamZach and links the AGN support server on every page', async () => {
        const i = interaction('help');
        await commands.find((c) => c.data.name === 'help')!.run(i);
        const home = i.replies[0];

        assert.match(text(home), /Made by \*\*IamZach\*\*/);
        assert.match(text(home), /discord\.gg\/agn/);
        assert.match(home.embeds[0].data.footer.text, /IamZach/);

        const button = home.components[1].components[0].data;
        assert.equal(button.label, 'Join the support server');
        assert.equal(button.url, 'https://discord.gg/agn');

        const help = handlers.find((h) => h.prefix === 'help')!;
        for (const category of ['General', 'Players', 'Moderation', 'Economy', 'Server']) {
            const sel: any = { ...interaction('help'), isStringSelectMenu: () => true, values: [category] };
            sel.replies = [];
            sel.update = async (p: unknown) => sel.replies.push(p);
            await help.run(sel, []);
            const page = sel.replies[0];
            assert.match(text(page), /IamZach/, category);
            assert.equal(page.components[1].components[0].data.url, 'https://discord.gg/agn');
            assert.ok(text(page).length < 4096, `${category} page fits in an embed`);
        }
    });

    test('lists every command and subcommand', async () => {
        const i = interaction('help');
        await commands.find((c) => c.data.name === 'help')!.run(i);
        assert.match(text(i.replies[0]), /\*\*\d{2}\*\* commands/);
    });
});

describe('command definitions', () => {
    test('every command is valid for Discord and named uniquely', () => {
        const names = new Set<string>();
        for (const c of commands) {
            const json = c.data.toJSON() as any;
            assert.ok(!names.has(json.name), `duplicate ${json.name}`);
            names.add(json.name);
            if (json.type !== 2) assert.ok(json.description.length <= 100, json.name);
        }
        assert.ok(commands.length >= 25);
    });

    test('tiers fall back sensibly and config overrides win', () => {
        const ban = commands.find((c) => c.data.name === 'ban')!;
        const server = commands.find((c) => c.data.name === 'server')!;
        const top = commands.find((c) => c.data.name === 'top')!;

        assert.equal(needed(ban), 1); // mod
        assert.equal(needed(server, 'status'), 0); // support
        assert.equal(needed(server, 'restart'), 2); // admin
        assert.equal(needed(top), -1);

        setConfig(normalize({ serverName: 'Test RP', permissions: { ban: 'owner', 'server status': 'mod' } }));
        assert.equal(needed(ban), 3);
        assert.equal(needed(server, 'status'), 1);

        setConfig(normalize({ serverName: 'Test RP', tiers: [{ name: 'staff', roles: [] }] }));
        assert.equal(needed(ban), 0, 'unknown tier name means top tier');
        setConfig(normalize({ serverName: 'Test RP' }));
    });

    test('non-staff are turned away before a command runs', async () => {
        addPlayer(1, 'Alice');
        sessions.start(1);
        const i = interaction('kick', { player: '@1', reason: 'x' });
        await handle(i);
        assert.match(text(i.replies[0]), /need to be \*\*mod\*\*/);
        assert.ok(players.has(1), 'not kicked');

        const h = interaction('help');
        await handle(h);
        assert.match(text(h.replies[0]), /IamZach/);
    });
});

describe('moderation', () => {
    const run = async (name: string, opts: Record<string, unknown>, sub?: string) => {
        const i = interaction(name, opts, sub);
        await commands.find((c) => c.data.name === name)!.run(i);
        return text(i.replies.at(-1));
    };

    test('warn records it and pops up in game', async () => {
        addPlayer(2, 'Bob');
        sessions.start(2);
        assert.match(await run('warn', { player: '@2', reason: 'RDM' }), /1\*\* warning/);
        assert.match(await run('warn', { player: '@2', reason: 'VDM' }), /2\*\* warnings/);
        assert.equal(net.at(-1)!.event, 'fivecord:message');
        assert.match(await run('warnings', { player: 'bob' }, 'view'), /VDM/);
    });

    test('ban kicks an online player with the ban screen and blocks rejoin', async () => {
        addPlayer(3, 'Carl');
        sessions.start(3);
        const tokens = players.get(3)!.tokens;
        assert.match(await run('ban', { player: '@3', length: '3d', reason: 'Exploiting' }), /Banned .*for 3d/);
        assert.match(dropped.at(-1)!.reason, /Exploiting/);
        assert.equal(bans.check(['license:other'], tokens)?.ban.name, 'Carl');

        assert.match(await run('ban', { player: '#carlhash', length: '1d', reason: 'again' }), /already banned/);
        assert.match(await run('ban', { player: '#carlhash', length: 'whenever', reason: 'x' }), /doesn't make sense/);
    });

    test('offline players can be banned from what we saw of them', async () => {
        addPlayer(4, 'Dana');
        sessions.start(4);
        await sessions.end(4, 'quit');
        players.delete(4);
        assert.match(await run('ban', { player: 'dana', length: 'perm', reason: 'Alt of Carl' }), /permanently/);
        assert.ok(bans.check(['license:danahash'], []));
    });

    test('unban lifts it', async () => {
        const b = bans.list(true).find((x) => x.name === 'Dana')!;
        assert.match(await run('unban', { ban: b.id }), /Lifted/);
        assert.match(await run('unban', { ban: b.id }), /isn't active/);
    });

    test('kick and freeze need the player online', async () => {
        assert.match(await run('kick', { player: 'dana', reason: 'x' }), /isn't online/);
        addPlayer(6, 'Eve');
        sessions.start(6);
        assert.match(await run('freeze', { player: '@6' }), /Froze/);
        assert.match(await run('freeze', { player: '@6' }), /Unfroze/);
        assert.match(await run('kick', { player: '@6', reason: 'AFK' }), /Kicked/);
        assert.equal(dropped.at(-1)!.reason, 'Kicked by staff: AFK');
    });

    test('notes show up and can be removed', async () => {
        addPlayer(7, 'Finn');
        sessions.start(7);
        assert.match(await run('note', { player: '@7', text: 'Watch for VDM' }, 'add'), /Added note #\d+/);
        const [n] = await db().entries('note', 'license:finnhash');
        assert.equal(n!.text, 'Watch for VDM');
        assert.match(await run('note', { id: n!.id }, 'remove'), /Removed/);
    });

    test('teleport to a saved location or another player', async () => {
        setConfig(normalize({ serverName: 'Test RP', locations: { 'Legion Square': { x: 1, y: 2, z: 3 } } }));
        addPlayer(8, 'Gus');
        addPlayer(9, 'Hal');
        assert.match(await run('teleport', { player: '@8', location: 'Legion Square' }), /Legion Square/);
        assert.deepEqual(net.at(-1)!.args, [1, 2, 3]);
        assert.match(await run('teleport', { player: '@8', to: '@9' }), /Hal/);
        assert.deepEqual(net.at(-1)!.args, [109, 200, 30]);
        assert.match(await run('teleport', { player: '@8', coords: '1, nope' }), /look like/);
        assert.equal(wardenAllowed.length, 0, 'warden not running');

        states.warden = 'started';
        await run('teleport', { player: '@8', location: 'Legion Square' });
        assert.deepEqual(wardenAllowed.at(-1), [8, 'teleport', 10]);
        delete states.warden;
    });

    test('money and items go through the framework bridge', async () => {
        addPlayer(10, 'Ivy');
        assert.match(await run('money', { player: '@10', action: 'add', amount: 500, account: 'bank' }), /Gave \$500 to bank/);
        assert.match(await run('giveitem', { player: '@10', item: 'water' }), /cannot carry that/);
        assert.match(await run('setjob', { player: '@10', job: 'police', grade: 1 }), /Police · Officer/);
    });

    test('server lock and status', async () => {
        assert.match(await run('server', { reason: 'Updating' }, 'lock'), /locked/);
        const i = interaction('server', {}, 'status');
        await commands.find((c) => c.data.name === 'server')!.run(i);
        assert.match(text(i.replies[0]), /Locked/);
        assert.match(await run('server', {}, 'unlock'), /unlocked/);
    });
});

describe('in game', () => {
    test('reports explain when they are not set up', async () => {
        game.registerCommands();
        addPlayer(11, 'Jay');
        sessions.start(11);
        await registered.get('report')!(11, ['help', 'me'], '/report help me');
        await tick();
        assert.match(String((net.at(-1)!.args[0] as any).description), /not set up/);
    });

    test('non-staff can not use staff chat', async () => {
        const before = net.length;
        await registered.get('sc')!(11, ['hi'], '/sc hi');
        assert.equal(net.length, before);
    });
});

describe('exports', () => {
    test('are registered under discordbridge and zdiscord names too', () => {
        for (const name of ['getDiscordId', 'getRoles', 'hasRole', 'isRolePresent', 'getTier', 'isStaff', 'ban', 'warn', 'log', 'send', 'announce']) {
            assert.ok(exported.has(name), name);
        }
        addPlayer(12, 'Kim');
        sessions.start(12);
        assert.equal(exported.get('getDiscordId')!(12), '100000000000000012');
        assert.equal(exported.get('isStaff')!(12), false);
    });

    test('log takes a screenshot from an anticheat', () => {
        assert.doesNotThrow(() => exported.get('log')!('anticheat', 'Kicked', 'Noclip', 0xff0000, 'data:image/jpeg;base64,/9j/4AAQ'));
        assert.doesNotThrow(() => exported.get('log')!('anticheat', 'Kicked', 'Noclip', 0xff0000, 'not a data uri'));
    });

    test('screenshots and clips come from fivecapture when it runs', async () => {
        addPlayer(14, 'Rae');
        sessions.start(14);
        const by = { id: '1', username: 'Zach', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } as any;
        const t = { src: 14, name: 'Rae' } as any;
        assert.match((await act.record(by, t, 10)).text, /need `fivecapture`/);

        states.fivecapture = 'started';
        fakeCapture.result = { data: 'data:image/jpeg;base64,/9j/4AAQ' };
        const shot = await act.screenshot(by, t);
        assert.ok(shot.ok && shot.files?.length === 1, shot.text);
        assert.deepEqual(fakeCapture.calls.at(-1)!.slice(0, 2), ['screenshot', 14]);

        const dir = mkdtempSync(join(tmpdir(), 'fivecord-clip-'));
        writeFileSync(join(dir, 'c.webm'), 'webm');
        fakeCapture.result = { file: join(dir, 'c.webm'), size: 4 };
        const clip = await act.record(by, t, 12);
        assert.ok(clip.ok && clip.files?.length === 1, 'clip attached');
        assert.deepEqual(fakeCapture.calls.at(-1)!.slice(0, 3), ['record', 14, 12]);

        fakeCapture.result = { file: '/x/huge.webm', size: 50 * 1024 * 1024 };
        assert.match((await act.record(by, t, 30)).text, /Too big for Discord, saved on the server/);

        fakeCapture.error = 'player left';
        assert.match((await act.record(by, t, 5)).text, /failed: player left/);
        fakeCapture.error = false;

        // log only attaches videos from fivecapture's own folder
        assert.doesNotThrow(() => exported.get('log')!('anticheat', 'Banned', 'x', 0, undefined, '/etc/passwd'));
        assert.doesNotThrow(() => exported.get('log')!('anticheat', 'Banned', 'x', 0, undefined, '/srv/resources/fivecapture/captures/../../../etc/x.webm'));
        delete states.fivecapture;
    });

    test('anticheats can ban through the export', async () => {
        addPlayer(13, 'Lee');
        assert.equal(exported.get('ban')!(13, 'Noclip'), true);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(dropped.at(-1)!.src, 13);
        const b = bans.list(true).find((x) => x.name === 'Lee')!;
        assert.equal(b.staff, 'anticheat');
        assert.equal(b.expires, null);
    });
});
