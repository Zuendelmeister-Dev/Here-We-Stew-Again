import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKUP_FORMAT, BACKUP_VERSION, MAX_IMAGES, HttpError, checkArray, checkBackup,
  checkCategoryIcon, checkRating, checkRecipe, checkText, checkTimestamp, checkUpload,
  requireDate, requireId, requireObject,
} from '../lib/validation.mjs';

const rejects = (work, status = 400) => assert.throws(work, (error) =>
  error instanceof HttpError && error.status === status);

test('object and ID validation reject unexpected JSON shapes and unsafe identifiers', () => {
  const object = { title: 'Soup' };
  assert.equal(requireObject(object, 'Recipe'), object);
  for (const value of [null, undefined, [], 'text', 0, false]) {
    rejects(() => requireObject(value, 'Recipe'));
  }
  for (const value of ['recipe_1-A', 'x'.repeat(120)]) assert.equal(requireId(value, 'ID'), value);
  for (const value of ['', 'x'.repeat(121), '../recipe', 'a/b', 'with space', 1]) {
    rejects(() => requireId(value, 'ID'));
  }
});

test('text and list validation normalize values and enforce their limits', () => {
  assert.equal(checkText('  Cafe\u0301  ', 'Name', 4, true), 'Café');
  assert.equal(checkText(null, 'Notes', 10), '');
  assert.equal(checkText(undefined, 'Notes', 10), '');
  assert.equal(checkText('  ', 'Notes', 10), '');
  for (const value of [undefined, '  ', 1, 'abcde']) rejects(() => checkText(value, 'Name', 4, true));
  rejects(() => checkText(false, 'Notes', 10));
  const list = ['a', 'b'];
  assert.equal(checkArray(list, 'Items', 2), list);
  assert.deepEqual(checkArray([], 'Items', 0), []);
  rejects(() => checkArray(list, 'Items', 1));
  rejects(() => checkArray({}, 'Items'));
});

test('category icons and ratings allow supported values and optional empty values', () => {
  assert.equal(checkCategoryIcon('soup'), 'soup');
  assert.equal(checkCategoryIcon(null), null);
  assert.equal(checkCategoryIcon(undefined), null);
  rejects(() => checkCategoryIcon('unknown'));
  rejects(() => checkCategoryIcon({ icon: 'soup' }));
  for (const value of [null, 1, 5]) assert.equal(checkRating(value), value);
  for (const value of [undefined, 0, 6, 1.5, '5', NaN]) rejects(() => checkRating(value));
});

test('recipe validation fills defaults and preserves supported recipe fields', () => {
  assert.deepEqual(checkRecipe({ title: '  Soup  ' }), {
    title: 'Soup', categoryId: null, description: '', ingredients: [], steps: [],
    notes: '', difficulty: null, rating: null, images: [],
  });
  const recipe = checkRecipe({
    title: 'Soup', categoryId: 'soups', description: '  Family recipe ',
    ingredients: ['  Water ', '', null],
    steps: [{ text: '  Simmer ', minutes: 1440 }, { text: 'Serve' }, { text: ' ' }],
    notes: '  Hot ', difficulty: 'easy', rating: 5, images: [{ id: 'photo' }],
  });
  assert.deepEqual(recipe, {
    title: 'Soup', categoryId: 'soups', description: 'Family recipe', ingredients: ['Water'],
    steps: [{ text: 'Simmer', minutes: 1440 }, { text: 'Serve', minutes: 0 }],
    notes: 'Hot', difficulty: 'easy', rating: 5, images: [{ id: 'photo' }],
  });
  assert.equal(checkRecipe({ title: 'Soup', categoryId: '' }).categoryId, null);
  for (const difficulty of ['medium', 'hard']) {
    assert.equal(checkRecipe({ title: 'Soup', difficulty }).difficulty, difficulty);
  }
});

test('recipe validation rejects invalid fields, durations and oversized collections', () => {
  const atLimits = checkRecipe({
    title: 'x'.repeat(160), description: 'x'.repeat(2000), notes: 'x'.repeat(12000),
    ingredients: Array(200).fill('x'.repeat(500)),
    steps: Array(100).fill({ text: 'x'.repeat(4000), minutes: 0 }), images: Array(MAX_IMAGES).fill({}),
  });
  assert.equal(atLimits.ingredients.length, 200);
  assert.equal(atLimits.steps.length, 100);
  assert.equal(atLimits.images.length, MAX_IMAGES);
  const invalid = [
    { title: '' }, { title: 'x'.repeat(161) }, { categoryId: '../soups' },
    { description: 'x'.repeat(2001) }, { notes: 'x'.repeat(12001) },
    { difficulty: 'expert' }, { rating: 0 },
    { ingredients: {} }, { ingredients: ['x'.repeat(501)] }, { ingredients: Array(201).fill('Salt') },
    { steps: {} }, { steps: [null] }, { steps: [{ text: 'x'.repeat(4001) }] },
    { steps: Array(101).fill({ text: 'Stir' }) },
    { images: {} }, { images: Array(MAX_IMAGES + 1).fill({}) },
  ];
  for (const patch of invalid) rejects(() => checkRecipe({ title: 'Soup', ...patch }));
  for (const minutes of [-1, 1441, 1.5, '5']) {
    rejects(() => checkRecipe({ title: 'Soup', steps: [{ text: 'Simmer', minutes }] }));
  }
});

test('calendar dates and timestamps reject rollover and preserve export/import compatibility', () => {
  for (const value of ['2024-02-29', '0000-01-01', '9999-12-31']) assert.equal(requireDate(value), value);
  for (const value of ['2023-02-29', '2026-02-31', '2026-13-01', '2026-00-01', '2026-11-00', '2026-1-01', null]) {
    rejects(() => requireDate(value));
  }
  const fallback = '2026-11-17T12:00:00.000Z';
  assert.equal(checkTimestamp(undefined, fallback), fallback);
  assert.equal(checkTimestamp(null, fallback), fallback);
  for (const value of ['2024-02-29T12:30:00Z', '9999-12-31T23:59:59.999Z', '0000-01-01T00:00:00.000Z']) {
    const normalized = checkTimestamp(value, fallback);
    assert.equal(checkTimestamp(normalized, fallback), normalized);
    assert.equal(normalized, new Date(value).toISOString());
  }
  for (const value of [
    '2023-02-29T00:00:00Z', '2026-02-31T12:00:00Z', '2026-11-17T24:00:00Z',
    '9999-12-31T24:00:00Z', '2026-11-17T25:00:00Z', '2026-13-01T00:00:00Z',
    '2026-11-17T12:00:00+01:00', '2026-11-17', 'invalid', 1,
  ]) rejects(() => checkTimestamp(value, fallback));
});

test('backup validation checks version and required lists while recipe imports ignore history', () => {
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, categories: [], recipes: [], history: [] };
  assert.deepEqual(checkBackup(backup), { categories: [], recipes: [], history: [] });
  for (const patch of [
    { format: 'another-app' }, { version: 2 }, { version: '1' },
    { categories: null }, { recipes: {} }, { history: undefined },
  ]) rejects(() => checkBackup({ ...backup, ...patch }));
  assert.deepEqual(checkBackup({ ...backup, history: 'ignored' }, { includeHistory: false }).history, []);
});

function upload(contents, mime, name = '  Photo  ') {
  return { name, dataUrl: `data:${mime};base64,${contents.toString('base64')}` };
}

function avif(major, compatible) {
  const contents = Buffer.alloc(compatible ? 20 : 16);
  contents.writeUInt32BE(contents.length);
  contents.write(`ftyp${major}`, 4, 'ascii');
  if (compatible) contents.write(compatible, 16, 'ascii');
  return contents;
}

test('image validation recognizes supported signatures and verifies declared MIME types', () => {
  // Minimal file headers exercise format identification without bundling image fixtures.
  const fixtures = [
    ['image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['image/jpeg', Buffer.from('ffd8ffe0', 'hex')],
    ['image/gif', Buffer.from('GIF87a')], ['image/gif', Buffer.from('GIF89a')],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
    ['image/avif', avif('avif')], ['image/avif', avif('avis')], ['image/avif', avif('mif1', 'avif')],
  ];
  for (const [mime, contents] of fixtures) {
    const result = checkUpload(upload(contents, mime), contents.length);
    assert.equal(result.name, 'Photo');
    assert.equal(result.mime, mime);
    assert.deepEqual(result.contents, contents);
    const otherMime = mime === 'image/png' ? 'image/jpeg' : 'image/png';
    rejects(() => checkUpload(upload(contents, otherMime), 100));
  }
  const png = fixtures[0][1];
  assert.equal(checkUpload(upload(png, 'IMAGE/PNG', ' '), 100).name, 'Recipe photo');
  rejects(() => checkUpload(upload(Buffer.from('<svg/>'), 'image/png'), 100));
  rejects(() => checkUpload(upload(avif('mif1', 'heic'), 'image/avif'), 100));
});

test('image validation rejects malformed base64, unsupported formats and both size-limit cases', () => {
  for (const value of [null, {}, { dataUrl: 1 }, { dataUrl: 'data:image/svg+xml;base64,AAAA' }]) {
    rejects(() => checkUpload(value, 100));
  }
  for (const base64 of ['', 'AAA', 'AAAA\n', 'AA?=', '=AAA', 'A===']) {
    rejects(() => checkUpload({ dataUrl: `data:image/png;base64,${base64}` }, 100));
  }
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  rejects(() => checkUpload(upload(png, 'image/png'), 3), 413);
  // Seven- and eight-byte files have equal base64 lengths, so decoded size needs its own check.
  rejects(() => checkUpload(upload(png, 'image/png'), 7), 413);
  rejects(() => checkUpload(upload(png, 'image/png', 'x'.repeat(256)), 100));
});
