import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Auth } from '../lib/auth.mjs';
import { BookStore } from '../lib/store.mjs';

const sampleImages = fileURLToPath(new URL('../public/images', import.meta.url));
const defaults = { username: 'steward', password: 'cooksagain' };
const account = { username: 'family-cook', password: 'A private family password' };

function request(cookie = '', address = '127.0.0.1') {
  return { headers: { cookie }, socket: { remoteAddress: address } };
}

function response() {
  const headers = new Map();
  return { headers, setHeader: (name, value) => headers.set(name, value) };
}

function cookie(reply) {
  return reply.headers.get('Set-Cookie').split(';', 1)[0];
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'stew-auth-test-'));
  let store;
  t.after(async () => {
    try {
      store?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  store = new BookStore(directory, sampleImages, 8 * 1024 * 1024);
  return { store, auth: new Auth(store.database, false) };
}

test('setup sessions expire after fifteen minutes even when the browser sends the cookie', async (t) => {
  const { store, auth } = await fixture(t);
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const reply = response();
  assert.deepEqual(await auth.login(request(), reply, defaults), { setupRequired: true });
  assert.match(reply.headers.get('Set-Cookie'), /Max-Age=900;/);
  const sessionRequest = request(cookie(reply));
  now += 15 * 60 * 1000 - 1;
  assert.equal(auth.getSession(sessionRequest).setupRequired, true);
  assert.throws(() => auth.requireAccess(sessionRequest), { status: 403 });

  now += 1;
  assert.equal(auth.getSession(sessionRequest), null);
  assert.throws(() => auth.requireAccess(sessionRequest), { status: 401 });
  await assert.rejects(auth.setup(sessionRequest, response(), account), { status: 401 });
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM account').get().count, 0);
});

test('configured sessions expire at twelve hours and setup invalidates its earlier session', async (t) => {
  const { auth } = await fixture(t);
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const initial = response();
  await auth.login(request(), initial, defaults);
  const setupRequest = request(cookie(initial));
  const configured = response();
  assert.deepEqual(await auth.setup(setupRequest, configured, account), { setupRequired: false });
  assert.equal(auth.getSession(setupRequest), null);
  assert.match(configured.headers.get('Set-Cookie'), /Max-Age=43200;/);
  const sessionRequest = request(cookie(configured));

  now += 12 * 60 * 60 * 1000 - 1;
  assert.doesNotThrow(() => auth.requireAccess(sessionRequest));
  now += 1;
  assert.equal(auth.getSession(sessionRequest), null);
  assert.throws(() => auth.requireAccess(sessionRequest), { status: 401 });
  const signedInAgain = response();
  assert.deepEqual(await auth.login(request(), signedInAgain, account), { setupRequired: false });
  assert.doesNotThrow(() => auth.requireAccess(request(cookie(signedInAgain))));
});

test('login throttling is per address, resets after a minute and clears after a successful login', async (t) => {
  const { auth } = await fixture(t);
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const wrong = { ...defaults, password: 'wrong password' };
  for (let attempt = 0; attempt < 10; attempt++) {
    await assert.rejects(auth.login(request(), response(), wrong), { status: 401 });
  }
  const blocked = response();
  await assert.rejects(auth.login(request(), blocked, defaults), { status: 429 });
  assert.equal(blocked.headers.has('Set-Cookie'), false);
  assert.deepEqual(await auth.login(request('', '192.0.2.1'), response(), defaults), { setupRequired: true });

  now += 59_999;
  await assert.rejects(auth.login(request(), response(), defaults), { status: 429 });
  now += 1;
  assert.deepEqual(await auth.login(request(), response(), defaults), { setupRequired: true });

  for (let attempt = 0; attempt < 9; attempt++) {
    await assert.rejects(auth.login(request(), response(), wrong), { status: 401 });
  }
  await auth.login(request(), response(), defaults);
  for (let attempt = 0; attempt < 10; attempt++) {
    await assert.rejects(auth.login(request(), response(), wrong), { status: 401 });
  }
  await assert.rejects(auth.login(request(), response(), defaults), { status: 429 });
});

test('invalid credentials cannot create an account or issue an authenticated session', async (t) => {
  const { store, auth } = await fixture(t);
  const initial = response();
  await auth.login(request(), initial, defaults);
  const setupRequest = request(cookie(initial));
  const invalid = [
    null, [], 'credentials', {},
    { username: '', password: 'password' },
    { username: '   ', password: 'password' },
    { username: 123, password: 'password' },
    { username: 'a'.repeat(81), password: 'password' },
    { username: 'cook', password: '' },
    { username: 'cook', password: '   ' },
    { username: 'cook', password: 123 },
    { username: 'cook', password: 'a'.repeat(257) },
  ];
  for (const value of invalid) {
    const loginReply = response();
    await assert.rejects(auth.login(request(), loginReply, value), { status: 400 });
    assert.equal(loginReply.headers.has('Set-Cookie'), false);
    await assert.rejects(auth.setup(setupRequest, response(), value), { status: 400 });
  }
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM account').get().count, 0);
  assert.equal(auth.getSession(setupRequest).setupRequired, true);

  await auth.setup(setupRequest, response(), account);
  for (const value of [
    { ...account, username: 'someone-else' },
    { ...account, password: 'wrong password' },
    defaults,
  ]) {
    const reply = response();
    await assert.rejects(auth.login(request(), reply, value), { status: 401 });
    assert.equal(reply.headers.has('Set-Cookie'), false);
    assert.equal(auth.getSession(request()), null);
  }
});
