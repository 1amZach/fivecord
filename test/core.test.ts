import { commands, files, players, addPlayer, lua, net, dropped } from './env';
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import * as aces from '../src/aces';
import * as bans from '../src/bans';
import * as bridge from '../src/bridge';
import { normalize, setConfig } from '../src/config';
import { gate, lock } from '../src/connect';
import { openStore } from '../src/db';
import { nextDaily, schedule, cancel, tick as restartTick } from '../src/restarts';
import * as sessions from '../src/sessions';
import { resolve } from '../src/targets';
import { fill, formatDuration, parseDuration } from '../src/util';

describe('durations', () => {
    test('parses', () => {
        assert.equal(parseDuration('30m'), 1800);
        assert.equal(parseDuration('1d12h'), 129600);
        assert.equal(parseDuration(' 2 w '), 1209600);
        assert.equal(parseDuration('perm'), null);
        assert.equal(parseDuration('0'), null);
        assert.equal(parseDuration('soon'), undefined);
        assert.equal(parseDuration('12'), undefined);
    });

    test('formats', () => {
        assert.equal(formatDuration(45), '45s');
        assert.equal(formatDuration(3660), '1h 1m');
        assert.equal(formatDuration(90061), '1d 1h');
        assert.equal(formatDuration(1209600), '2w');
    });

    test('fills templates and leaves unknown keys', () => {
        assert.equal(fill('{players}/{max} {nope}', { players: 3, max: 64 }), '3/64 {nope}');
    });
});

describe('config from Lua', () => {
    test('drops placeholder role ids and accepts {} for empty lists', () => {
        const c = normalize({
            guild: '123456789012345678',
            tiers: [{ name: 'Mod', roles: [''] }, { name: 'admin', roles: ['234567890123456789'] }],
            allowlist: { enabled: true, roles: {} },
            channels: { staffChat: 'not an id', reports: '345678901234567890' },
            restarts: { times: ['06:00', 'noon'], warnings: { 1: 5, 2: 30 } },
            locations: { Good: { x: 1, y: 2, z: 3 }, Bad: { x: 1 } },
        });
        assert.equal(c.guild, '123456789012345678');
        assert.deepEqual(c.tiers, [{ name: 'mod', roles: [] }, { name: 'admin', roles: ['234567890123456789'] }]);
        assert.deepEqual(c.allowlist, { enabled: true, roles: [] });
        assert.equal(c.channels.staffChat, '');
        assert.equal(c.channels.reports, '345678901234567890');
        assert.deepEqual(c.restarts.times, ['06:00']);
        assert.deepEqual(c.restarts.warnings, [30, 5]);
        assert.deepEqual(Object.keys(c.locations), ['Good']);
    });

    test('has sane defaults with nothing set', () => {
        const c = normalize({});
        assert.equal(c.tiers.length, 4);
        assert.equal(c.commands.report, 'report');
        assert.equal(c.allowlist.enabled, false);
    });
});

describe('bridge', () => {
    test('round trips through Lua and unpacks Lua tables', async () => {
        assert.equal(await bridge.framework(), 'qb');
        const [job] = await bridge.jobs();
        assert.equal(job!.name, 'police');
        assert.deepEqual(job!.grades.map((g) => g.label), ['Recruit', 'Officer']);
        assert.deepEqual(await bridge.gangs(), []);
        assert.deepEqual(await bridge.money(1, 'bank', 'set', 50), { ok: true, balance: 50 });
        assert.deepEqual(await bridge.giveItem(1, 'water', 1), { ok: false, error: 'cannot carry that' });
    });

    test('rejects when Lua has no such function', async () => {
        await assert.rejects(bridge.call('nope'), /no bridge function/);
    });
});

describe('players, bans and connecting', async () => {
    setConfig(normalize({ serverName: 'Test RP', appeal: 'https://example.com/appeal' }));
    await openStore();
    await bans.loadBans();

    beforeEach(() => {
        players.clear();
        lock.on = false;
    });

    test('file store persists players', async () => {
        addPlayer(1, 'Alice');
        sessions.start(1);
        await new Promise((r) => setTimeout(r, 1100));
        const saved = JSON.parse(files.get('data.json')!);
        assert.equal(saved.players['license:alicehash'].name, 'Alice');
    });

    test('resolves players many ways', async () => {
        addPlayer(1, 'Alice');
        addPlayer(2, 'Bob');
        sessions.start(1);
        sessions.start(2);

        assert.equal((await resolve('@2'))?.name, 'Bob');
        assert.equal((await resolve('2'))?.name, 'Bob');
        assert.equal((await resolve('ali'))?.src, 1);
        assert.equal((await resolve('<@100000000000000002>'))?.name, 'Bob');
        assert.equal((await resolve('#alicehash'))?.src, 1);
        assert.equal(await resolve('@9'), undefined);

        // offline but seen before
        players.delete(1);
        sessions.sessions.delete(1);
        const off = await resolve('#alicehash');
        assert.equal(off?.src, undefined);
        assert.equal(off?.name, 'Alice');
    });

    test('a ban blocks the account and its alts, ignoring IPs', async () => {
        addPlayer(5, 'Cheater');
        const p = players.get(5)!;
        const ban = await bans.add({
            license: p.ids[0]!,
            name: 'Cheater',
            identifiers: p.ids,
            tokens: p.tokens,
            reason: 'Aimbot',
            staff: 'Zach',
            duration: 86400,
        });
        assert.ok(!ban.identifiers.some((id) => id.startsWith('ip:')));

        const same = await gate(p.ids, p.tokens, 'Cheater');
        assert.match(same!, /banned from Test RP/);
        assert.match(same!, /Aimbot/);
        assert.match(same!, new RegExp(`#${ban.id}`));
        assert.match(same!, /example.com\/appeal/);

        // new account, same PC
        const alt = await gate(['license:fresh', 'ip:10.0.0.5'], p.tokens, 'Totally New');
        assert.match(alt!, /banned/);
        assert.equal(bans.check(['license:fresh'], p.tokens)?.evading, true);

        // shares only an IP with the banned player: let in
        assert.equal(await gate(['license:neighbour', 'ip:10.0.0.5'], [], 'Neighbour'), undefined);

        await bans.revoke(ban.id, 'Zach');
        assert.equal(await gate(p.ids, p.tokens, 'Cheater'), undefined);
        assert.equal(bans.get(ban.id)?.revokedBy, 'Zach');
    });

    test('expired bans stop applying', async () => {
        const b = await bans.add({ license: 'license:old', name: 'Old', identifiers: [], tokens: [], reason: 'x', staff: 'y', duration: 60 });
        b.expires = Math.floor(Date.now() / 1000) - 1;
        assert.equal(bans.check(['license:old'], []), undefined);
        assert.equal(bans.activeFor('license:old'), undefined);
    });

    test('a locked server turns away players while Discord is down', async () => {
        lock.on = true;
        lock.reason = 'Back at 5pm';
        assert.match((await gate(['license:x'], [], 'X'))!, /maintenance\. Back at 5pm/);
    });

    test('the allowlist lets players in if Discord is down instead of locking everyone out', async () => {
        setConfig(normalize({ allowlist: { enabled: true, roles: ['234567890123456789'] } }));
        assert.equal(await gate(['license:x'], [], 'X'), undefined);
        setConfig(normalize({ serverName: 'Test RP' }));
    });
});

describe('aces', () => {
    test('adds and removes only our own principals', () => {
        setConfig(normalize({ aces: { '111111111111111111': 'group.admin', '222222222222222222': 'group.mod' } }));
        commands.length = 0;

        aces.sync(7, ['111111111111111111', '999']);
        assert.deepEqual(commands, ['add_principal player.7 group.admin']);

        aces.sync(7, ['222222222222222222']);
        assert.deepEqual(commands.slice(1), ['add_principal player.7 group.mod', 'remove_principal player.7 group.admin']);

        aces.clear(7);
        assert.equal(commands.at(-1), 'remove_principal player.7 group.mod');
        assert.deepEqual(aces.principals(7), []);
    });
});

describe('restarts', () => {
    test('finds the next daily restart', () => {
        const from = new Date(2026, 0, 10, 7, 30);
        const at = nextDaily(['06:00', '18:00'], from)!;
        assert.equal(new Date(at * 1000).getHours(), 18);
        const late = nextDaily(['06:00'], new Date(2026, 0, 10, 23, 0))!;
        assert.equal(new Date(late * 1000).getDate(), 11);
        assert.equal(nextDaily([], from), undefined);
    });

    test('warns once when several warnings are already due, then counts down', () => {
        setConfig(normalize({ restarts: { warnings: [30, 15, 10, 5, 1] } }));
        net.length = 0;

        const p = schedule(3, 'Updates', 'zach');
        const announces = net.filter((n) => n.event === 'fivecord:announce');
        assert.equal(announces.length, 1);
        assert.match(String(announces[0]!.args[1]), /in 3 minutes/);

        restartTick();
        assert.equal(net.filter((n) => n.event === 'fivecord:announce').length, 1);

        p.at = Math.floor(Date.now() / 1000) + 50;
        restartTick();
        assert.match(String(net.at(-1)!.args[1]), /under a minute/);

        assert.ok(cancel());
        assert.match(String(net.at(-1)!.args[0]), /cancelled/);
    });

    test('a due restart kicks everyone and runs the command', async () => {
        setConfig(normalize({ restarts: { command: 'quit "bye"' } }));
        addPlayer(3, 'Carl');
        dropped.length = 0;
        commands.length = 0;
        const p = schedule(1, '', 'zach');
        p.at = Math.floor(Date.now() / 1000) - 1;
        restartTick();
        await new Promise((r) => setTimeout(r, 3100));
        assert.equal(dropped[0]?.src, 3);
        assert.deepEqual(commands, ['quit "bye"']);
    });
});

// keep the Lua table shape tests honest about what's being faked
test('fake Lua returns a Lua-style keyed table for grades', () => {
    assert.ok(!Array.isArray((lua.jobs!()[0] as any[])[0].grades));
});
