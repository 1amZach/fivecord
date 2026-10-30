import { exported, files, registered } from './env';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

test('the built bundle boots inside a FiveM-like runtime', async () => {
    const logs: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(' '));

    createRequire(import.meta.url)('../dist/server.js');
    await new Promise((r) => setTimeout(r, 300));
    console.error = error;

    assert.ok(exported.has('hasRole') && exported.has('ban'), 'exports registered with FiveM');
    assert.ok(registered.has('report') && registered.has('sc'), 'in-game commands registered');
    assert.ok(logs.some((l) => l.includes('no bot token')), 'explains the missing token');
    assert.equal(files.size, 0, 'nothing written before anything happens');
});
