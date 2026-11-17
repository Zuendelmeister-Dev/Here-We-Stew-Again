import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BookStore } from '../lib/store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultCredentials = { username: 'steward', password: 'cooksagain' };
const examples = join(root, 'examples');

async function temporaryData(t) {
  const directory = await mkdtemp(join(tmpdir(), 'here-we-stew-test-'));
  const stops = [];
  t.after(async () => {
    await Promise.all(stops.map((stop) => stop()));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, stops };
}

async function startServer(data, secureCookies = '0') {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data.directory,
      SECURE_COOKIES: secureCookies, MAX_IMPORT_BYTES: '', MAX_IMAGE_BYTES: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exited = once(server, 'exit');
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await exited;
  };
  data.stops.push(stop);
  const stdout = createInterface({ input: server.stdout });
  try {
    const [line] = await Promise.race([
      once(stdout, 'line', { signal: AbortSignal.timeout(5000) }),
      exited.then(([code]) => { throw new Error(`Server exited with code ${code}. ${stderr}`); }),
    ]);
    const origin = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(origin, line);
    const request = async (path, status, { method = 'GET', body, cookie } = {}) => {
      const response = await fetch(origin + path, {
        method,
        headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (status !== undefined) assert.equal(response.status, status, `${method} ${path}`);
      return response;
    };
    const post = (path, status, body, cookie) => request(path, status, { method: 'POST', body, cookie });
    return { request, post, stop };
  } finally {
    stdout.close();
  }
}

function session(response) {
  return response.headers.get('set-cookie').split(';', 1)[0];
}

async function completeSetup(server, credentials = defaultCredentials) {
  const login = await server.post('/api/auth/login', 200, defaultCredentials);
  const result = await server.post('/api/auth/setup', 200, credentials, session(login));
  return session(result);
}

test('sign-in protects the cookbook until setup and logout revokes the session', async (t) => {
  const server = await startServer(await temporaryData(t), '1');
  const { request, post } = server;
  const page = await request('/', 200);
  assert.match(await page.text(), /<html lang="en">/);
  await request('/api/health', 200);
  await request('/api/book', 401);
  await request('/api/export', 401);
  await post('/api/categories', 401, { name: 'Private' });
  await post('/api/auth/setup', 401, defaultCredentials);
  const failed = await post('/api/auth/login', 401, { ...defaultCredentials, password: 'cooksgain' });
  assert.equal((await failed.json()).error, 'Incorrect username or password.');

  const login = await post('/api/auth/login', 200, defaultCredentials);
  assert.deepEqual(await login.json(), { setupRequired: true });
  assert.match(login.headers.get('set-cookie'), /Path=\/api\/; Max-Age=900; HttpOnly; SameSite=Strict; Secure$/);
  const pending = session(login);
  const otherLogin = session(await post('/api/auth/login', 200, defaultCredentials));
  await request('/api/book', 403, { cookie: pending });

  const setup = await post('/api/auth/setup', 200, defaultCredentials, pending);
  assert.deepEqual(await setup.json(), { setupRequired: false });
  const cookie = session(setup);
  assert.notEqual(cookie, pending);
  await request('/api/book', 401, { cookie: pending });
  await request('/api/book', 401, { cookie: otherLogin });
  await post('/api/auth/setup', 409, defaultCredentials, cookie);

  const book = await (await request('/api/book', 200, { cookie })).json();
  assert.deepEqual(book.categories.map(({ name }) => name), ['Soups', 'Starters', 'Main Courses']);
  const soup = book.recipes.find(({ title }) => title === 'Roasted Tomato Soup');
  assert.ok(soup.images.length);
  const imagePath = soup.images[0].url;
  await request(imagePath, 401);
  const image = await request(imagePath, 200, { cookie });
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.ok((await image.arrayBuffer()).byteLength);

  const loggedOut = await post('/api/auth/logout', 204, {}, cookie);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  await request('/api/book', 401, { cookie });
  assert.deepEqual(await (await post('/api/auth/login', 200, defaultCredentials)).json(), { setupRequired: false });
});

test('database upgrades preserve recipes and configured credentials survive restart', async (t) => {
  const data = await temporaryData(t);
  const previous = new BookStore(data.directory, join(root, 'public', 'images'), 8 * 1024 * 1024);
  const recipeId = previous.saveRecipe({ title: 'Family recipe', notes: 'Keep this note' });
  previous.setCooked(recipeId, '2026-11-14', true);
  previous.database.exec(`
    DROP TABLE account;
    ALTER TABLE recipes DROP COLUMN difficulty;
    ALTER TABLE recipes DROP COLUMN rating;
    PRAGMA user_version = 2;
  `);
  previous.close();

  const server = await startServer(data);
  const credentials = { username: 'home-cook', password: '  a different password  ' };
  const first = session(await server.post('/api/auth/login', 200, defaultCredentials));
  const second = session(await server.post('/api/auth/login', 200, defaultCredentials));
  const results = await Promise.all([first, second].map((cookie) =>
    server.post('/api/auth/setup', undefined, credentials, cookie)));
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 401]);
  const oldSession = session(results.find(({ ok }) => ok));
  const book = await (await server.request('/api/book', 200, { cookie: oldSession })).json();
  const upgraded = book.recipes.find(({ id }) => id === recipeId);
  assert.equal(upgraded.notes, 'Keep this note');
  assert.equal(upgraded.difficulty, null);
  assert.equal(upgraded.rating, null);
  assert.deepEqual(book.history, [{ recipeId, date: '2026-11-14' }]);
  await server.stop();

  const database = new DatabaseSync(join(data.directory, 'kochbuch.sqlite'), { readOnly: true });
  try {
    const { salt, password_hash: hash } = database.prepare('SELECT salt, password_hash FROM account').get();
    assert.ok(salt instanceof Uint8Array && salt.length >= 16);
    assert.ok(hash instanceof Uint8Array && hash.length >= 32);
    assert.notEqual(Buffer.from(hash).toString(), credentials.password);
  } finally {
    database.close();
  }
  const restarted = await startServer(data);
  await restarted.request('/api/book', 401, { cookie: oldSession });
  await restarted.post('/api/auth/login', 401, defaultCredentials);
  const current = await restarted.post('/api/auth/login', 200, credentials);
  assert.deepEqual(await current.json(), { setupRequired: false });
});

test('example files import individually or together and round-trip through a cookbook backup', async (t) => {
  const { request, post } = await startServer(await temporaryData(t));
  const cookie = await completeSetup({ post });
  const demo = JSON.parse(await readFile(join(examples, 'example-cookbook.json'), 'utf8'));
  const recipeFiles = (await readdir(join(examples, 'recipes'), { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  assert.equal(recipeFiles.length, demo.recipes.length);
  assert.ok(demo.categories.length >= 3 && demo.history.length > demo.recipes.length);

  const recipeIds = new Set();
  for (const file of recipeFiles) {
    const example = JSON.parse(await readFile(join(file.parentPath, file.name), 'utf8'));
    assert.equal(example.recipes.length, 1, file.name);
    const { recipeId, importedRecipes, importedCategories } = await (await post('/api/import?mode=recipe', 200, example, cookie)).json();
    assert.equal(importedRecipes, 1, file.name);
    assert.equal(importedCategories, 0, file.name);
    recipeIds.add(recipeId);
    assert.deepEqual(example.recipes[0], demo.recipes.find(({ id }) => id === recipeId));
  }
  assert.equal(recipeIds.size, demo.recipes.length);
  const beforeMerge = await (await request('/api/book', 200, { cookie })).json();
  assert.equal(beforeMerge.categories.length, 3);
  assert.ok(beforeMerge.recipes.filter(({ id }) => recipeIds.has(id)).every(({ categoryId }) => categoryId === null));
  await post('/api/import?mode=recipe', 400, demo, cookie);
  const merged = await (await post('/api/import?mode=merge', 200, demo, cookie)).json();
  assert.equal(merged.importedRecipes, 0);
  assert.equal(merged.importedCategories, demo.categories.length);
  assert.equal(merged.importedHistory, demo.history.length);
  assert.equal((await (await post('/api/import?mode=merge', 200, demo, cookie)).json()).importedHistory, 0);

  const exportResponse = await request('/api/export', 200, { cookie });
  assert.match(exportResponse.headers.get('content-disposition'), /filename="cookbook-\d{4}-\d{2}-\d{2}\.json"/);
  const backup = await exportResponse.json();
  assert.equal(backup.recipes.length, demo.recipes.length + 3);
  assert.ok(backup.recipes.some(({ images }) => images.some(({ dataUrl }) => dataUrl.startsWith('data:image/jpeg;base64,'))));
  assert.deepEqual(Object.keys(backup).sort(), ['categories', 'exportedAt', 'format', 'history', 'recipes', 'version']);

  await post('/api/import?mode=replace', 400, { ...demo, history: [{ date: '2026-11-02', recipeId: 'missing' }] }, cookie);
  assert.deepEqual((await (await request('/api/book', 200, { cookie })).json()).history, backup.history);
  await post('/api/import?mode=replace', 200, demo, cookie);
  assert.equal((await (await request('/api/book', 200, { cookie })).json()).recipes.length, demo.recipes.length);
  await post('/api/import?mode=replace', 200, backup, cookie);
  assert.equal((await (await request('/api/book', 200, { cookie })).json()).recipes.length, backup.recipes.length);

  const id = demo.recipes[0].id;
  const date = '2026-11-18';
  await post(`/api/recipes/${id}/cooked`, 204, { date }, cookie);
  const exportedRecipe = await (await request(`/api/recipes/${id}/export`, 200, { cookie })).json();
  assert.equal(exportedRecipe.recipes[0].id, id);
  assert.deepEqual(exportedRecipe.history, []);
  await request(`/api/recipes/${id}/cooked?date=${date}`, 204, { method: 'DELETE', cookie });
  const book = await (await request('/api/book', 200, { cookie })).json();
  assert.ok(!book.history.some((entry) => entry.recipeId === id && entry.date === date));
});

test('recipe exports preserve photo bytes, cover order, rating and difficulty on import', async (t) => {
  const { request, post } = await startServer(await temporaryData(t));
  const cookie = await completeSetup({ post });
  const original = await (await post('/api/categories', 201, { name: 'Salads', icon: 'salad' }, cookie)).json();
  const destination = await (await post('/api/categories', 201, { name: 'Salate', icon: 'salad' }, cookie)).json();
  const images = await Promise.all(['tomatensuppe.jpg', 'burrata.jpg'].map(async (name) => {
    const data = await readFile(join(root, 'public', 'images', name));
    return { name, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` };
  }));
  const recipe = {
    title: 'Recipe with photos',
    categoryId: original.id,
    difficulty: 'medium',
    rating: 4,
    steps: [{ text: 'Simmer.', minutes: 10 }],
    images,
  };
  await post('/api/recipes', 400, { ...recipe, difficulty: 'very hard' }, cookie);
  await post('/api/recipes', 400, { ...recipe, rating: 6 }, cookie);
  const { id } = await (await post('/api/recipes', 201, recipe, cookie)).json();
  const exportRecipe = async (id) => (await request(`/api/recipes/${id}/export`, 200, { cookie })).json();
  const originalExport = await exportRecipe(id);
  assert.deepEqual(originalExport.recipes[0].images.map(({ name, dataUrl }) => ({ name, dataUrl })), images);
  const imageIds = originalExport.recipes[0].images.map(({ id }) => ({ id })).reverse();
  await request(`/api/recipes/${id}`, 200, {
    method: 'PUT', cookie, body: { ...recipe, rating: 5, images: imageIds },
  });
  const exported = await exportRecipe(id);
  const path = `/api/import?mode=recipe&categoryId=${destination.id}`;
  await post('/api/import?mode=recipe&categoryId=missing', 400, exported, cookie);
  const imported = await (await post(path, 200, exported, cookie)).json();
  const repeated = await (await post(path, 200, exported, cookie)).json();
  assert.equal(imported.importedCategories, 0);
  assert.equal(imported.importedRecipes, 1);
  assert.equal(repeated.importedRecipes, 0);
  assert.equal(repeated.recipeId, imported.recipeId);
  const reimported = (await exportRecipe(imported.recipeId)).recipes[0];
  assert.equal(reimported.categoryId, destination.id);
  assert.equal(reimported.difficulty, 'medium');
  assert.equal(reimported.rating, 5);
  assert.deepEqual(reimported.images.map(({ name, dataUrl }) => ({ name, dataUrl })), [...images].reverse());
});

test('recipe ratings can be updated and cleared independently', async (t) => {
  const { request, post } = await startServer(await temporaryData(t));
  const cookie = await completeSetup({ post });
  const getRecipe = async (id) => (await (await request('/api/book', 200, { cookie })).json())
    .recipes.find((recipe) => recipe.id === id);
  const book = await (await request('/api/book', 200, { cookie })).json();
  const recipe = book.recipes.find(({ images }) => images.length > 0);
  const ratingPath = `/api/recipes/${recipe.id}/rating`;
  const updateRating = (body, status = 200) => request(ratingPath, status, { method: 'PATCH', body, cookie });

  await request(ratingPath, 401, { method: 'PATCH', body: { rating: 5 } });
  await request('/api/recipes/missing/rating', 404, { method: 'PATCH', body: { rating: 5 }, cookie });
  assert.deepEqual(await (await updateRating({ rating: 5 })).json(), { rating: 5 });
  for (const body of [{}, { rating: 0 }, { rating: 6 }, { rating: '5' }]) {
    await updateRating(body, 400);
  }
  assert.deepEqual(await getRecipe(recipe.id), { ...recipe, rating: 5 });
  assert.deepEqual(await (await updateRating({ rating: null })).json(), { rating: null });
  assert.deepEqual(await getRecipe(recipe.id), { ...recipe, rating: null });
});
