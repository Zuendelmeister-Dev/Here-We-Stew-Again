import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BookStore } from '../lib/store.mjs';
import { temporaryData, startServer, session } from './helpers/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const defaultCredentials = { username: 'steward', password: 'cooksagain' };
const examples = join(root, 'examples');

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
    DROP TABLE recovery_account;
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
    assert.equal(example.recipes[0].images.length, 1, `${file.name} includes its cover photo`);
    const { recipeId, importedRecipes, importedCategories } = await (await post('/api/import?mode=recipe', 200, example, cookie)).json();
    assert.equal(importedRecipes, 1, file.name);
    assert.equal(importedCategories, 0, file.name);
    recipeIds.add(recipeId);
    assert.deepEqual(example.recipes[0], demo.recipes.find(({ id }) => id === recipeId));
    const imported = await (await request(`/api/recipes/${recipeId}/export`, 200, { cookie })).json();
    assert.equal(imported.recipes[0].images[0].dataUrl, example.recipes[0].images[0].dataUrl);
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

test('category and recipe CRUD preserve ownership, roll back failed edits and cascade deletion', async (t) => {
  const { request, post } = await startServer(await temporaryData(t));
  const cookie = await completeSetup({ post });
  const book = async () => (await request('/api/book', 200, { cookie })).json();
  const category = await (await post('/api/categories', 201, { name: 'Garden', icon: 'salad' }, cookie)).json();
  await post('/api/categories', 409, { name: ' garden ' }, cookie);
  await request(`/api/categories/${category.id}`, 200, { method: 'PUT', body: { name: 'Harvest' }, cookie });
  assert.deepEqual((await book()).categories.find(({ id }) => id === category.id), { ...category, name: 'Harvest' });
  await request('/api/categories/missing', 404, { method: 'PUT', body: { name: 'Missing' }, cookie });

  const photo = await readFile(join(root, 'public', 'images', 'tomatensuppe.jpg'));
  const recipe = { title: 'Garden soup', categoryId: category.id, images: [
    { name: 'Soup', dataUrl: `data:image/jpeg;base64,${photo.toString('base64')}` },
  ] };
  const { id } = await (await post('/api/recipes', 201, recipe, cookie)).json();
  const original = (await book()).recipes.find((entry) => entry.id === id);
  const ownImage = original.images[0];
  const foreignImage = (await book()).recipes.find((entry) => entry.id !== id && entry.images.length).images[0];
  for (const images of [[ownImage, ownImage], [foreignImage], [{ name: 'Bad', dataUrl: 'data:image/png;base64,AAAA' }]]) {
    await request(`/api/recipes/${id}`, 400, { method: 'PUT', cookie, body: { ...recipe, title: 'Must roll back', images } });
    assert.deepEqual((await book()).recipes.find((entry) => entry.id === id), original);
  }
  await request(foreignImage.url, 200, { cookie });

  const cooked = `/api/recipes/${id}/cooked`;
  await post(cooked, 400, { date: '2026-02-29' }, cookie);
  await post(cooked, 204, { date: '2026-11-17' }, cookie);
  await post(cooked, 204, { date: '2026-11-17' }, cookie);
  assert.equal((await book()).history.filter((entry) => entry.recipeId === id).length, 1);
  await request(`/api/categories/${category.id}`, 204, { method: 'DELETE', cookie });
  assert.equal((await book()).recipes.find((entry) => entry.id === id).categoryId, null);
  await request(`/api/categories/${category.id}`, 404, { method: 'DELETE', cookie });

  const imageHead = await request(ownImage.url, 200, { method: 'HEAD', cookie });
  assert.equal(imageHead.headers.get('content-length'), String(photo.byteLength));
  assert.equal((await imageHead.arrayBuffer()).byteLength, 0);
  await request(`/api/recipes/${id}`, 204, { method: 'DELETE', cookie });
  const remaining = await book();
  assert.ok(!remaining.recipes.some((entry) => entry.id === id));
  assert.ok(!remaining.history.some((entry) => entry.recipeId === id));
  await request(ownImage.url, 404, { cookie });
  await request(`/api/recipes/${id}`, 404, { method: 'DELETE', cookie });
  await request(`/api/recipes/${id}`, 404, { method: 'PUT', body: { title: 'Missing' }, cookie });
  await request(`/api/recipes/${id}/export`, 404, { cookie });
  await post(`/api/recipes/${id}/cooked`, 404, { date: '2026-11-17' }, cookie);
});

test('HTTP rejects malformed, oversized and unsupported requests while keeping the server usable', async (t) => {
  const { request, post } = await startServer(await temporaryData(t), '0', { MAX_IMPORT_BYTES: '128' });
  const cookie = await completeSetup({ post });
  const jsonHeaders = { 'Content-Type': 'application/json' };
  await request('/api/categories', 415, { method: 'POST', rawBody: '{}', cookie });
  await request('/api/categories', 400, { method: 'POST', rawBody: '{broken', headers: jsonHeaders, cookie });
  await request('/api/categories', 400, { method: 'POST', body: [], cookie });
  await request('/api/categories', 413, { method: 'POST', rawBody: JSON.stringify({ name: 'x'.repeat(16 * 1024) }), headers: jsonHeaders, cookie });
  await request('/api/import', 413, { method: 'POST', rawBody: ' '.repeat(129), headers: jsonHeaders, cookie });
  // An async body has no Content-Length, exercising the streaming size limit.
  await request('/api/import', 413, {
    method: 'POST', rawBody: new Blob([' '.repeat(129)]).stream(), headers: jsonHeaders, cookie,
  });
  await post('/api/import?mode=unknown', 400, {}, cookie);
  await request('/api/unknown', 404, { cookie });
  for (const [path, method, allow] of [
    ['/api/health', 'POST', 'GET'], ['/api/auth/login', 'GET', 'POST'],
    ['/api/book', 'POST', 'GET'], ['/api/export', 'POST', 'GET'],
    ['/api/import', 'GET', 'POST'], ['/api/categories', 'GET', 'POST'],
    ['/api/categories/missing', 'GET', 'PUT, DELETE'], ['/api/recipes', 'GET', 'POST'],
    ['/api/recipes/missing', 'GET', 'PUT, DELETE'], ['/api/recipes/missing/cooked', 'GET', 'POST, DELETE'],
    ['/api/recipes/missing/rating', 'GET', 'PATCH'], ['/api/recipes/missing/export', 'POST', 'GET'],
    ['/api/images/missing', 'POST', 'GET, HEAD'], ['/', 'POST', 'GET, HEAD'],
  ]) {
    const response = await request(path, 405, { method, cookie });
    assert.equal(response.headers.get('allow'), allow, `${method} ${path}`);
  }
  for (const path of ['/%2e%2e%2fpackage.json', '/%5cpackage.json', '/%00.json', '/missing.js', '/%ZZ']) {
    await request(path, path === '/%ZZ' ? 400 : 404);
  }
  const head = await request('/', 200, { method: 'HEAD' });
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
  assert.match(head.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal((await request('/api/book', 200, { cookie })).headers.get('cache-control'), 'no-store');
});
