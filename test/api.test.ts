import { addPlayer, dropped, net, players } from './env';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { registerApi, run } from '../src/api';
import * as bans from '../src/bans';
import '../src/commands';
import { normalize, setConfig } from '../src/config';
import { lock } from '../src/connect';
import { openStore } from '../src/db';
import * as sessions from '../src/sessions';

const staff = { id: '555555555555555555', name: 'Zach (panel)' };
const open = Object.fromEntries(
    ['players', 'lookup', 'message', 'warn', 'kick', 'freeze', 'teleport', 'ban', 'unban', 'bans', 'note', 'warnings', 'server', 'announce'].map((k) => [k, 'everyone']),
);

before(async () => {
    setConfig(normalize({ serverName: 'Test RP' }));
    await openStore();
    await bans.loadBans();
});

describe('api', () => {
    test('refuses staff below the tier a command needs', async () => {
        addPlayer(30, 'Target');
        sessions.start(30);
        await assert.rejects(run('act', ['kick', '@30', 'x'], staff), /need to be mod/);
        assert.ok(players.has(30));
    });

    test('access lists every permission key', async () => {
        const a: any = await run('access', [], staff);
        assert.equal(a.tier, -1);
        assert.equal(a.needs.kick, 1);
        assert.equal(a.needs['server restart'], 2);
        assert.equal(a.needs.console, 3);
        assert.deepEqual(a.tiers, ['support', 'mod', 'admin', 'owner']);
    });

    test('actions go through the same code as the slash commands', async () => {
        setConfig(normalize({ serverName: 'Test RP', permissions: open, locations: {} }));
        addPlayer(31, 'Pat');
        sessions.start(31);

        const list: any = await run('players', [], staff);
        assert.ok(list.some((p: any) => p.src === 31 && p.license === 'license:pathash'));

        assert.match((await run('act', ['warn', '@31', 'RDM'], staff) as any).text, /1 warning/);
        assert.match((await run('act', ['note', '@31', 'Watch him'], staff) as any).text, /Added note/);
        const profile: any = await run('profile', ['@31'], staff);
        assert.equal(profile.warnings[0].text, 'RDM');
        assert.equal(profile.notes[0].staff, 'Zach (panel)');
        assert.ok(!profile.identifiers.some((id: string) => id.startsWith('ip:')), 'ips not sent');

        await run('act', ['freeze', '@31', true], staff);
        assert.deepEqual(net.at(-1)!.args, [true]);

        await run('act', ['teleport', '@31', 1, 2, 3], staff);
        assert.deepEqual(net.at(-1)!.args, [1, 2, 3]);
        await assert.rejects(run('act', ['teleport', '@31', 'x', 2, 3], staff), /coords/);

        await assert.rejects(run('act', ['ban', '@31', 'soon', 'x'], staff), /doesn't make sense/);
        assert.match((await run('act', ['ban', '@31', '2d', 'Exploit'], staff) as any).text, /Banned/);
        assert.match(dropped.at(-1)!.reason, /Exploit/);

        const list2: any = await run('bans', [true, 'pat'], staff);
        assert.equal(list2[0].name, 'Pat');
        assert.equal(list2[0].tokens, undefined, 'tokens not sent');
        assert.match((await run('unban', [list2[0].id, ''], staff) as any).text, /Lifted/);
    });

    test('server controls', async () => {
        await run('server', ['lock', 'Updating'], staff);
        assert.deepEqual(lock, { on: true, reason: 'Updating' });
        const s: any = await run('status', [], staff);
        assert.equal(s.lock.on, true);
        await run('server', ['unlock'], staff);
        assert.equal(lock.on, false);
        await run('server', ['announce', 'Hi', 'There'], staff);
        assert.equal(net.at(-1)!.event, 'fivecord:announce');
    });

    test('answers over events', async () => {
        registerApi();
        const g = globalThis as any;
        const answers: unknown[][] = [];
        g.on('fivecord:api:done', (...a: unknown[]) => answers.push(a));
        g.emit('fivecord:api', 7, 'nothing', [], staff);
        g.emit('fivecord:api', 8, 'access', [], undefined);
        await new Promise((r) => setTimeout(r, 10));
        assert.deepEqual(answers[0], [7, false, 'Unknown action nothing']);
        assert.equal(answers[1]![1], false);
    });
});
