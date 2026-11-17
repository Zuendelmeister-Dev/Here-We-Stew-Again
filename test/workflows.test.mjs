import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindWorkflows, renderEditor } from '../public/workflows.js';

const renderHelpers = {
  escape: (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]),
  icon: () => '',
};

test('an open recipe draft clears a deleted category without losing unsaved content', () => {
  const state = {
    recipeId: null,
    categoryId: 'soups',
    book: { categories: [{ id: 'soups', name: 'Soups' }], recipes: [] },
  };
  renderEditor(state, renderHelpers);
  const draft = state.editor;
  draft.title = 'Unsaved soup';
  draft.ingredients = ['500 g potatoes'];
  draft.images.push({ name: 'soup.png', dataUrl: 'data:image/png;base64,AA==' });

  // Deleting a category refreshes the book while preserving the editor draft.
  state.book.categories = [];
  renderEditor(state, renderHelpers);

  assert.equal(state.editor, draft);
  assert.equal(draft.categoryId, '');
  assert.equal(draft.title, 'Unsaved soup');
  assert.deepEqual(draft.ingredients, ['500 g potatoes']);
  assert.equal(draft.images.length, 1);
});

test('redrawing an editor preserves a category that still exists', () => {
  const state = {
    recipeId: null,
    categoryId: 'soups',
    book: { categories: [{ id: 'soups', name: 'Soups' }], recipes: [] },
  };
  renderEditor(state, renderHelpers);
  renderEditor(state, renderHelpers);
  assert.equal(state.editor.categoryId, 'soups');
});

test('failed workflow changes show an error notification and release the pending state', async () => {
  const listeners = new Map();
  const root = {
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => true,
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const state = { view: 'detail', recipeId: 'soup' };
  const busy = [];
  let notify;
  const notification = new Promise((resolve) => { notify = resolve; });
  const cleanup = bindWorkflows(root, state, {
    request: async () => { throw new Error('The cookbook server is currently unavailable.'); },
    setBusy: (value) => busy.push(value),
    dateKey: () => '2026-11-17',
    toast: (message, type) => notify({ message, type }),
  });
  const button = { dataset: { wfAction: 'mark-cooked' } };
  listeners.get('click')({ target: { closest: () => button }, preventDefault() {} });

  assert.deepEqual(await notification, {
    message: 'The cookbook server is currently unavailable.', type: 'error',
  });
  assert.equal(state.workflowPending, false);
  assert.deepEqual(busy, [true, false]);
  cleanup();
});
