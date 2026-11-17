import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { temporaryData, startServer, session } from './helpers/server.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const defaults = { username: 'steward', password: 'cooksagain' };
const original = { username: 'family-cook', password: 'Original family password' };

async function configure(server) {
  const login = await server.post('/api/auth/login', 200, defaults);
  return session(await server.post('/api/auth/setup', 200, original, session(login)));
}

async function createRecovery(data) {
  const { stdout } = await run(process.execPath, ['recovery.mjs'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: data.directory },
    timeout: 10_000,
  });
  const username = stdout.match(/^Username: (.+)$/m)?.[1].trim();
  const password = stdout.match(/^Password: (.+)$/m)?.[1].trim();
  assert.ok(username && password, 'The CLI prints the generated username and password.');
  return { username, password };
}

function recoveryRows(data) {
  const database = new DatabaseSync(join(data.directory, 'kochbuch.sqlite'), { readOnly: true });
  try {
    return database.prepare('SELECT * FROM recovery_account').all();
  } finally {
    database.close();
  }
}

test('recovery CLI requires an existing configured cookbook', async (t) => {
  const data = await temporaryData(t);
  const options = { cwd: root, env: { ...process.env, DATA_DIR: data.directory }, timeout: 10_000 };
  await assert.rejects(run(process.execPath, ['recovery.mjs'], options));
  assert.deepEqual(await readdir(data.directory), []);

  const server = await startServer(data);
  assert.equal(recoveryRows(data).length, 0);
  await assert.rejects(run(process.execPath, ['recovery.mjs'], options));
  assert.equal(recoveryRows(data).length, 0);
  await configure(server);
  assert.equal(recoveryRows(data).length, 0);
});

test('one CLI recovery account can reset credentials and is revoked on replacement or use', async (t) => {
  const data = await temporaryData(t);
  const server = await startServer(data);
  const mainCookie = await configure(server);
  const before = await (await server.request('/api/book', 200, { cookie: mainCookie })).json();
  const first = await createRecovery(data);
  const firstLogin = await server.post('/api/auth/login', 200, first);
  assert.deepEqual(await firstLogin.json(), { setupRequired: true, recoveryRequired: true });
  assert.match(firstLogin.headers.get('set-cookie'), /Max-Age=900;/);
  const firstCookie = session(firstLogin);
  const restricted = await server.request('/api/book', 403, { cookie: firstCookie });
  assert.equal((await restricted.json()).recoveryRequired, true);
  await server.request('/api/export', 403, { cookie: firstCookie });
  await server.request(before.recipes[0].images[0].url, 403, { cookie: firstCookie });
  await server.post('/api/categories', 403, { name: 'Unauthorized change' }, firstCookie);
  await server.post('/api/auth/setup', 400, { username: '', password: '' }, firstCookie);

  const second = await createRecovery(data);
  assert.notEqual(second.username, first.username);
  assert.notEqual(second.password, first.password);
  const rows = recoveryRows(data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, second.username);
  assert.ok(rows[0].salt instanceof Uint8Array && rows[0].salt.length >= 16);
  assert.ok(rows[0].password_hash instanceof Uint8Array && rows[0].password_hash.length >= 32);
  assert.ok(!JSON.stringify(rows).includes(second.password));
  await server.post('/api/auth/login', 401, first);
  await server.request('/api/book', 401, { cookie: firstCookie });
  await server.post('/api/auth/setup', 401, { username: 'stale', password: 'stale' }, firstCookie);
  await server.request('/api/book', 200, { cookie: mainCookie });
  await server.post('/api/auth/login', 200, original);

  const backup = await (await server.request('/api/export', 200, { cookie: mainCookie })).json();
  assert.deepEqual(Object.keys(backup).sort(), ['categories', 'exportedAt', 'format', 'history', 'recipes', 'version']);
  assert.ok(!JSON.stringify(backup).includes(second.username));
  assert.ok(!JSON.stringify(backup).includes(second.password));
  const login = await server.post('/api/auth/login', 200, second);
  const recoveryCookie = session(login);
  const otherCookie = session(await server.post('/api/auth/login', 200, second));
  const replacement = { username: 'recovered-cook', password: 'New family password' };
  const reset = await server.post('/api/auth/setup', 200, replacement, recoveryCookie);
  assert.deepEqual(await reset.json(), { setupRequired: false });
  const recoveredCookie = session(reset);
  assert.equal(recoveryRows(data).length, 0);
  assert.deepEqual(await (await server.request('/api/book', 200, { cookie: recoveredCookie })).json(), before);
  for (const cookie of [mainCookie, recoveryCookie, otherCookie]) {
    await server.request('/api/book', 401, { cookie });
  }
  await server.post('/api/auth/login', 401, original);
  await server.post('/api/auth/login', 401, second);
  await server.post('/api/auth/login', 200, replacement);

  await server.stop();
  const restarted = await startServer(data);
  await restarted.post('/api/auth/login', 401, second);
  await restarted.post('/api/auth/login', 200, replacement);
  assert.equal(recoveryRows(data).length, 0);
});

test('recovery survives restart and overlapping resets have exactly one winner', async (t) => {
  const data = await temporaryData(t);
  const server = await startServer(data);
  await configure(server);
  const recovery = await createRecovery(data);
  const oldCookie = session(await server.post('/api/auth/login', 200, recovery));
  await server.stop();
  const restarted = await startServer(data);
  await restarted.request('/api/book', 401, { cookie: oldCookie });
  const cookies = await Promise.all([0, 1].map(async () => session(await restarted.post('/api/auth/login', 200, recovery))));
  const replacements = [
    { username: 'first-reset', password: 'First reset password' },
    { username: 'second-reset', password: 'Second reset password' },
  ];
  const results = await Promise.all(cookies.map((cookie, index) =>
    restarted.post('/api/auth/setup', undefined, replacements[index], cookie)));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 401]);
  const winner = results.findIndex(({ status }) => status === 200);
  await restarted.post('/api/auth/login', 200, replacements[winner]);
  await restarted.post('/api/auth/login', 401, replacements[1 - winner]);
  await restarted.post('/api/auth/login', 401, recovery);
  assert.equal(recoveryRows(data).length, 0);
});

test('a failed account update preserves recovery credentials so the reset can be retried', async (t) => {
  const data = await temporaryData(t);
  const server = await startServer(data);
  const mainCookie = await configure(server);
  const recovery = await createRecovery(data);
  const recoveryCookie = session(await server.post('/api/auth/login', 200, recovery));
  const before = recoveryRows(data);
  const replacement = { username: 'retry-cook', password: 'Password after retry' };
  const database = new DatabaseSync(join(data.directory, 'kochbuch.sqlite'));
  try {
    database.exec(`
      CREATE TRIGGER reject_account_change BEFORE UPDATE ON account
      BEGIN
        SELECT RAISE(ABORT, 'Forced account update failure');
      END;
    `);
    await server.post('/api/auth/setup', 500, replacement, recoveryCookie);
    assert.deepEqual(recoveryRows(data), before);
    await server.request('/api/book', 200, { cookie: mainCookie });
    await server.post('/api/auth/login', 200, original);
    await server.request('/api/book', 403, { cookie: recoveryCookie });
    await server.post('/api/auth/login', 200, recovery);

    database.exec('DROP TRIGGER reject_account_change');
    await server.post('/api/auth/setup', 200, replacement, recoveryCookie);
    assert.equal(recoveryRows(data).length, 0);
    await server.post('/api/auth/login', 200, replacement);
    await server.post('/api/auth/login', 401, original);
  } finally {
    database.close();
  }
});

test('a configured version 4 cookbook gains recovery support while preserving account and photos', async (t) => {
  const data = await temporaryData(t);
  const server = await startServer(data);
  const mainCookie = await configure(server);
  const before = await (await server.request('/api/book', 200, { cookie: mainCookie })).json();
  const exported = await (await server.request('/api/export', 200, { cookie: mainCookie })).json();
  await server.stop();

  const previous = new DatabaseSync(join(data.directory, 'kochbuch.sqlite'));
  let account;
  try {
    account = previous.prepare('SELECT * FROM account').get();
    previous.exec('DROP TABLE recovery_account; PRAGMA user_version = 4');
  } finally {
    previous.close();
  }
  const restarted = await startServer(data);
  const cookie = session(await restarted.post('/api/auth/login', 200, original));
  assert.deepEqual(await (await restarted.request('/api/book', 200, { cookie })).json(), before);
  const upgradedExport = await (await restarted.request('/api/export', 200, { cookie })).json();
  assert.deepEqual(upgradedExport.recipes, exported.recipes);
  const upgraded = new DatabaseSync(join(data.directory, 'kochbuch.sqlite'), { readOnly: true });
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 5);
    assert.deepEqual(upgraded.prepare('SELECT * FROM account').get(), account);
  } finally {
    upgraded.close();
  }
  assert.equal(recoveryRows(data).length, 0);
  const recovery = await createRecovery(data);
  assert.deepEqual(await (await restarted.post('/api/auth/login', 200, recovery)).json(), {
    setupRequired: true, recoveryRequired: true,
  });
});
