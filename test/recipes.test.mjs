import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRecipes } from '../public/recipes.js';

test('recipe sorting uses the selected field and puts missing values last', () => {
  const recipes = [
    { id: 'missing', title: 'A', steps: [{ minutes: 0 }], rating: null },
    { id: 'long', title: 'C', steps: [{ minutes: 12 }, { minutes: 8 }], rating: 3 },
    { id: 'short', title: 'B', steps: [{ minutes: 5 }], rating: 5 },
  ];
  const history = new Map([['long', '2026-11-17'], ['short', '2026-11-16']]);
  const order = (mode) => sortRecipes(recipes, mode, history).map(({ id }) => id);
  assert.deepEqual(order('cooked-newest'), ['long', 'short', 'missing']);
  assert.deepEqual(order('cooked-oldest'), ['short', 'long', 'missing']);
  assert.deepEqual(order('time-shortest'), ['short', 'long', 'missing']);
  assert.deepEqual(order('time-longest'), ['long', 'short', 'missing']);
  assert.deepEqual(order('rating'), ['short', 'long', 'missing']);
  assert.deepEqual(order('title'), ['missing', 'short', 'long']);
  assert.deepEqual(order('added'), ['missing', 'long', 'short']);
});
