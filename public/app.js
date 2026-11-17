import { categoryIconOptions, icon } from './icons.js';
import { renderBookHero } from './hero.js';
import { recipeTraits, sortOptions, sortRecipes, timedMinutes } from './recipes.js';
import { renderDetail, renderEditor, renderCook, renderCalendar, bindWorkflows } from './workflows.js';

const topbar = document.querySelector('#topbar');
const sidebar = document.querySelector('#sidebar');
const main = document.querySelector('main');
const bookShell = main.parentElement;
const modal = document.querySelector('#modal');
const toasts = document.querySelector('#toasts');

const state = {
  book: { categories: [], recipes: [], history: [] },
  view: 'library', recipeId: null, categoryId: null, query: '',
  sort: 'added',
  featuredRecipeId: null,
  editor: null, cook: null, cookStartIndex: 0, calendar: null,
  auth: 'checking',
  loading: true, error: '', busy: false, sidebarOpen: false,
};

const dayFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const categoryPrefix = '#category/';
const legacyRoutes = {
  '#rezept': '#recipe',
  '#bearbeiten': '#edit',
  '#neues-rezept': '#new-recipe',
  '#kochen': '#cook',
  '#kalender': '#calendar',
  '#kategorie': '#category',
};
let locationHash;
let cleanupWorkflows;
let modalResolve;

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function dateKey(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function request(method, path, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = body instanceof File ? body : JSON.stringify(body);
  }
  const response = await fetch(path, options).catch(() => {
    throw new Error('The cookbook server is currently unavailable.');
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error || `The request failed (${response.status}).`);
    error.status = response.status;
    if (!path.startsWith('/api/auth/')) {
      if (response.status === 401) showAuth('login');
      if (response.status === 403) showAuth('setup');
    }
    throw error;
  }
  return result;
}

async function refresh() {
  state.book = await request('GET', '/api/book');
  state.auth = 'ready';
  if (state.categoryId && state.categoryId !== 'ohne' && !state.book.categories.some(({ id }) => id === state.categoryId)) {
    state.categoryId = null;
    if (state.view === 'library') {
      locationHash = '';
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }
  state.error = '';
  state.loading = false;
  render();
  return state.book;
}

function setBusy(busy) {
  state.busy = busy;
  if (busy) main.setAttribute('aria-busy', 'true');
  else main.removeAttribute('aria-busy');
}

function toast(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = type === 'error' ? 'toast toast-error' : 'toast';
  notification.innerHTML = `${icon(type === 'error' ? 'alert' : 'check-circle', 18)}<span>${escape(message)}</span>`;
  toasts.append(notification);
  setTimeout(() => notification.remove(), 5500);
}

function openModal(title, content) {
  modal.innerHTML = `<div class="modal-heading"><h2 id="modal-title">${escape(title)}</h2>
    <button type="button" class="icon-button" data-shell="close-modal" aria-label="Close">${icon('x')}</button></div>${content}`;
  if (!modal.open) modal.showModal();
}

function closeModal(answer = false) {
  const resolve = modalResolve;
  modalResolve = undefined;
  modal.close();
  resolve?.(answer);
}

function confirm(message) {
  openModal('Confirm deletion', `<p class="modal-copy">${escape(message)}</p>
    <div class="modal-actions"><button type="button" class="button button-secondary" data-shell="close-modal" autofocus>Cancel</button>
    <button type="button" class="button button-danger" data-shell="confirm-modal">Delete</button></div>`);
  return new Promise((resolve) => { modalResolve = resolve; });
}

function categoryHref(id) {
  if (id === 'ohne') return '#uncategorized';
  return id ? `${categoryPrefix}${encodeURIComponent(id)}` : '/';
}

function navigate(view, id, step) {
  const suffix = id ? `/${encodeURIComponent(id)}` : '';
  const hash = {
    library: id ? categoryHref(id) : '',
    detail: `#recipe${suffix}`, editor: id ? `#edit${suffix}` : '#new-recipe',
    cook: `#cook${suffix}${step ? `/${encodeURIComponent(step)}` : ''}`, calendar: '#calendar',
  }[view] ?? '';
  if (location.hash !== hash) {
    history.pushState(null, '', hash || `${location.pathname}${location.search}`);
  }
  applyRoute();
}

function applyRoute() {
  const hash = location.hash;
  if (hash === '#main-content' || hash === locationHash) return;
  locationHash = hash;
  const [fragment, encodedId, step] = hash.split('/');
  const part = legacyRoutes[fragment] ?? fragment;
  let id;
  try { id = encodedId ? decodeURIComponent(encodedId) : null; }
  catch { id = null; }
  const view = {
    '#recipe': 'detail', '#edit': 'editor', '#cook': 'cook',
    '#new-recipe': 'editor', '#calendar': 'calendar',
  }[part] || 'library';
  if (view === 'library' && state.view !== 'library') chooseFeaturedRecipe();
  if (view !== 'editor' || state.recipeId !== id) state.editor = null;
  const stepNumber = Number(step);
  state.cookStartIndex = view === 'cook' && /^[1-9]\d*$/.test(step) && Number.isSafeInteger(stepNumber) ? stepNumber - 1 : 0;
  state.cook = null;
  state.view = view;
  state.recipeId = view === 'library' ? null : id;
  if (view === 'library') {
    state.categoryId = part === '#category' ? id : part === '#uncategorized' ? 'ohne' : null;
    state.query = '';
  }
  state.sidebarOpen = false;
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

const helpers = { escape, icon, categoryIcon, dateKey, navigate, render, refresh, request, toast, confirm, setBusy };

function renderTopbar() {
  const libraryActive = state.view !== 'calendar';
  const dark = document.documentElement.dataset.theme === 'dark';
  topbar.innerHTML = `<div class="topbar-inner">
    <button type="button" class="icon-button mobile-menu" data-shell="toggle-sidebar" aria-controls="sidebar" aria-expanded="${state.sidebarOpen}" aria-label="Categories">${icon('menu', 23)}</button>
    <a class="brand" href="/" data-nav="library"><img class="brand-mark" src="/images/kuechenchronik.svg" width="40" height="40" alt=""><span>Here We Stew Again</span></a>
    <nav class="primary-nav" aria-label="Main navigation">
      <a href="/" data-nav="library" ${libraryActive ? 'aria-current="page"' : ''}>${icon('book', 18)} <span>Cookbook</span></a>
      <a href="#calendar" data-nav="calendar" ${libraryActive ? '' : 'aria-current="page"'}>${icon('calendar', 18)} <span>Cooking Calendar</span></a>
    </nav>
    <div class="topbar-actions">
      <div class="backup-actions">
        <button type="button" class="button button-ghost import-button" data-shell="import-book" aria-label="Import cookbook" title="Import cookbook">${icon('upload', 17)} <span>Import cookbook</span></button>
        <a class="button button-secondary export-button" href="/api/export" download aria-label="Export cookbook" title="Export cookbook">${icon('download', 17)} <span>Export cookbook</span></a>
        <button type="button" class="button button-ghost" data-shell="logout" aria-label="Sign out" title="Sign out">${icon('logout', 17)} <span>Sign out</span></button>
      </div>
      <label class="theme-switch" title="Dark mode">
        <input class="visually-hidden" type="checkbox" role="switch" id="theme-switch" aria-label="Dark mode" ${dark ? 'checked' : ''}>
        <span class="theme-track" aria-hidden="true">${icon('sun', 14)}${icon('moon', 14)}</span>
      </label>
    </div>
  </div>`;
}

function categoryIcon(category) {
  if (category?.icon) return category.icon;
  const name = category?.name ?? '';
  if (/soup|stew|suppe|eintopf/i.test(name)) return 'soup';
  if (/salad|starter|salat|vorspeise/i.test(name)) return 'salad';
  if (/main|pasta|haupt/i.test(name)) return 'utensils';
  return 'folder';
}

function categoryLink(id, name, symbol, count, editable = false) {
  const active = state.view === 'library' && state.categoryId === id;
  const href = categoryHref(id);
  return `<div class="chapter-row${active ? ' active' : ''}">
    <a class="chapter-link" href="${href}" data-nav="library" ${id ? `data-id="${escape(id)}"` : ''} ${active ? 'aria-current="page"' : ''}>
      ${icon(symbol, 19)}<span class="chapter-name">${escape(name)}</span><span class="chapter-count">${count}</span>
    </a>
    ${editable ? `<button type="button" class="icon-button chapter-edit" data-shell="edit-category" data-id="${escape(id)}" aria-label="Edit ${escape(name)}" title="Edit category">${icon('ellipsis', 18)}</button>` : ''}
  </div>`;
}

function renderSidebar() {
  const { categories, recipes, history: entries } = state.book;
  const counts = new Map();
  for (const recipe of recipes) counts.set(recipe.categoryId, (counts.get(recipe.categoryId) || 0) + 1);
  const uncategorized = recipes.filter((recipe) => !recipe.categoryId).length;
  const latest = entries.reduce((current, entry) => !current || entry.date > current.date ? entry : current, null);
  const latestRecipe = latest && recipes.find((recipe) => recipe.id === latest.recipeId);
  sidebar.classList.toggle('open', state.sidebarOpen);
  sidebar.innerHTML = `<div class="sidebar-inner">
    <div class="sidebar-title"><h2>Categories</h2><button type="button" class="icon-button add-chapter" data-shell="add-category" aria-label="Add category" title="Add category">${icon('plus', 18)}</button></div>
    <nav aria-label="Categories" class="chapters">
      ${categoryLink(null, 'All Recipes', 'book', recipes.length)}
      ${categories.map((category) => categoryLink(category.id, category.name, categoryIcon(category), counts.get(category.id) || 0, true)).join('')}
      ${uncategorized ? categoryLink('ohne', 'Uncategorized', 'folder', uncategorized) : ''}
    </nav>
    <div class="sidebar-rule"></div>
    <a class="history-shortcut" href="#calendar" data-nav="calendar">
      <span class="shortcut-icon">${icon('calendar', 19)}</span>
      <span class="shortcut-text"><strong>${latestRecipe ? 'Last cooked' : 'Cooking Calendar'}</strong>
        <small>${latestRecipe ? escape(latestRecipe.title) : 'View cooking history'}</small></span>
      ${icon('chevron-right', 15)}
    </a>
    ${state.sidebarOpen ? '<button type="button" class="button button-ghost sidebar-close" data-shell="toggle-sidebar">Close categories</button>' : ''}
  </div>`;
}

function chooseFeaturedRecipe() {
  const recipes = state.book.recipes;
  const candidates = recipes.length > 1 ? recipes.filter(({ id }) => id !== state.featuredRecipeId) : recipes;
  const choice = candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  state.featuredRecipeId = choice?.id ?? null;
  return choice;
}

function recipeCard(recipe, categories, lastCooked) {
  const { id, title, images, steps, description, categoryId } = recipe;
  const photo = images[0];
  const href = `#recipe/${encodeURIComponent(id)}`;
  const category = categories.get(categoryId);
  const chapter = category?.name ?? 'Uncategorized';
  const pictogram = categoryIcon(category);
  const minutes = timedMinutes(steps);
  const latest = lastCooked.get(id);
  const meta = minutes ? `${icon('clock', 15)} ${minutes} min timed` : `${icon('note', 15)} ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  return `<article class="recipe-card">
    <a class="recipe-card-link" href="${href}" data-nav="detail" data-id="${escape(id)}" aria-label="Open ${escape(title)}">
      <div class="recipe-photo${photo ? '' : ' recipe-placeholder'}">${photo ? `<img src="${escape(photo.url)}" alt="" loading="lazy" decoding="async">` : icon(pictogram, 42)}</div>
      <div class="recipe-card-body">
        <span class="recipe-category">${icon(pictogram, 15)} ${escape(chapter)}</span>
        <h3>${escape(title)}</h3>
        ${description ? `<p>${escape(description)}</p>` : ''}
        ${recipeTraits(recipe, helpers)}
        <div class="recipe-card-bottom"><span class="recipe-meta">${latest ? `${icon('calendar', 15)} ${latest === dateKey() ? 'Cooked today' : dayFormatter.format(new Date(`${latest}T12:00:00`))}` : meta}</span><span class="recipe-open">${icon('arrow-right', 17)}</span></div>
      </div>
    </a>
  </article>`;
}

function visibleRecipes() {
  const query = state.query.trim().toLowerCase();
  return state.book.recipes.filter((recipe) => {
    const category = state.categoryId;
    if (category === 'ohne' && recipe.categoryId) return false;
    if (category && category !== 'ohne' && recipe.categoryId !== category) return false;
    if (!query) return true;
    const terms = [recipe.title, recipe.description, recipe.notes, ...recipe.ingredients].join(' ').toLowerCase();
    return query.split(/\s+/).every((term) => terms.includes(term));
  });
}

function renderResults() {
  const visible = visibleRecipes();
  const count = document.querySelector('#recipe-count');
  const results = document.querySelector('#recipe-results');
  if (!count || !results) return;
  count.textContent = `${visible.length} ${visible.length === 1 ? 'recipe' : 'recipes'}`;
  const categories = new Map(state.book.categories.map((category) => [category.id, category]));
  const lastCooked = new Map();
  const today = dateKey();
  for (const { recipeId, date } of state.book.history) {
    if (date <= today && (!lastCooked.has(recipeId) || date > lastCooked.get(recipeId))) lastCooked.set(recipeId, date);
  }
  const recipes = sortRecipes(visible, state.sort, lastCooked);
  if (recipes.length) {
    results.innerHTML = `<div class="recipe-grid">${recipes.map((recipe) => recipeCard(recipe, categories, lastCooked)).join('')}</div>`;
    return;
  }
  results.innerHTML = `<div class="empty-state"><span class="empty-icon">${icon(state.query.trim() ? 'search' : 'book', 28)}</span>
    <h3>${state.query.trim() ? 'No matching recipes' : 'No recipes here yet'}</h3>
    ${state.query.trim() ? '<button type="button" class="button button-secondary" data-shell="clear-search">Clear search</button>' : `<a class="button button-primary" href="#new-recipe" data-nav="editor">${icon('plus', 18)} Add recipe</a>`}
  </div>`;
}

function renderLibrary() {
  const category = state.book.categories.find(({ id }) => id === state.categoryId);
  const title = category?.name || (state.categoryId === 'ohne' ? 'Uncategorized' : 'All Recipes');
  const featuredRecipe = state.book.recipes.find(({ id }) => id === state.featuredRecipeId) ?? chooseFeaturedRecipe();
  return `${renderBookHero(state.book, featuredRecipe, helpers)}
    <section class="library" aria-labelledby="library-title">
      <div class="library-toolbar"><div><h2 id="library-title">${escape(title)}</h2><p id="recipe-count" aria-live="polite"></p></div>
        <div class="library-actions">
          <label class="recipe-search">${icon('search', 18)}<span class="visually-hidden">Search recipes</span><input id="recipe-search" type="search" placeholder="Search…" value="${escape(state.query)}" autocomplete="off"></label>
          <select id="recipe-sort" class="recipe-sort" aria-label="Sort recipes">
            ${sortOptions.map(([value, label]) => `<option value="${value}" ${value === state.sort ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <button type="button" class="button button-secondary" data-shell="import-recipe">${icon('upload', 17)} Import recipes</button>
        </div>
      </div>
      <div id="recipe-results"></div>
    </section>`;
}

function showAuth(view) {
  if (state.auth === view) return;
  closeModal();
  modal.replaceChildren();
  topbar.replaceChildren();
  sidebar.replaceChildren();
  toasts.replaceChildren();
  state.auth = view;
  state.book = { categories: [], recipes: [], history: [] };
  state.editor = state.cook = state.calendar = null;
  state.featuredRecipeId = null;
  state.sidebarOpen = false;
  state.query = '';
  setBusy(false);
  render();
  main.querySelector('[name="username"]')?.focus();
}

function renderAuth(setup) {
  main.innerHTML = `<section class="auth-card" aria-labelledby="auth-title">
    <div class="brand"><img class="brand-mark" src="/images/kuechenchronik.svg" width="40" height="40" alt="">Here We Stew Again</div>
    <h1 id="auth-title">${setup ? 'Set up your credentials' : 'Sign in'}</h1>
    ${setup ? '<p class="muted">Set your username and password. You can re-enter the current values.</p>' : ''}
    <form id="auth-form" method="post">
      <label class="field">Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="80" required></label>
      <label class="field">Password<input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" maxlength="256" required></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="auth-actions">
        <button type="submit" class="button button-primary">${setup ? 'Save and open cookbook' : 'Sign in'}</button>
        ${setup ? '<button type="button" class="button button-ghost" data-shell="logout">Sign out</button>' : ''}
      </div>
    </form>
  </section>`;
}

async function submitAuth(form) {
  const setup = state.auth === 'setup';
  const submit = form.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  const buttons = form.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  const fields = new FormData(form);
  const error = form.querySelector('.form-error');
  error.hidden = true;
  try {
    const { setupRequired } = await request('POST', setup ? '/api/auth/setup' : '/api/auth/login', {
      username: fields.get('username'), password: fields.get('password'),
    });
    if (setupRequired) showAuth('setup');
    else {
      state.auth = 'checking';
      await loadBook();
    }
  } catch (failure) {
    if (setup && [401, 409].includes(failure.status)) showAuth('login');
    const message = main.querySelector('#auth-form .form-error');
    if (message) {
      message.textContent = failure.message;
      message.hidden = false;
    }
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function logout(button) {
  const submit = button.form?.querySelector('button[type="submit"]');
  button.disabled = true;
  if (submit) submit.disabled = true;
  try {
    await request('POST', '/api/auth/logout', {});
    showAuth('login');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    if (submit) submit.disabled = false;
  }
}

function render() {
  cleanupWorkflows?.();
  cleanupWorkflows = undefined;
  const authenticated = state.auth === 'ready';
  topbar.hidden = sidebar.hidden = !authenticated;
  bookShell.classList.toggle('auth-shell', !authenticated);
  if (authenticated) {
    renderTopbar();
    renderSidebar();
  } else if (state.auth !== 'checking') {
    renderAuth(state.auth === 'setup');
    return;
  }
  if (state.loading) {
    main.innerHTML = '<p class="loading">Opening the cookbook…</p>';
    return;
  }
  if (state.error) {
    main.innerHTML = `<div class="empty-state"><h1>Could not open the cookbook</h1><p>${escape(state.error)}</p><button type="button" class="button button-primary" data-shell="retry">Try again</button></div>`;
    return;
  }
  const viewRenderers = { detail: renderDetail, editor: renderEditor, cook: renderCook, calendar: renderCalendar };
  main.innerHTML = viewRenderers[state.view]?.(state, helpers) ?? renderLibrary();
  if (state.view === 'library') renderResults();
  else cleanupWorkflows = bindWorkflows(main, state, helpers);
  setBusy(state.busy);
}

function renderCategoryIcons(category) {
  const options = [{ id: '', label: 'Automatic' }, ...categoryIconOptions];
  const current = category?.icon ?? '';
  const automatic = categoryIcon({ name: category?.name });
  return `<fieldset class="category-pictograms"><legend>Icon</legend><div class="pictogram-grid">
    ${options.map(({ id, label }) => `<label class="pictogram-option">
      <input class="visually-hidden" type="radio" name="icon" value="${id}" ${current === id ? 'checked' : ''}>
      <span>${icon(id || automatic, 23)} ${escape(label)}</span>
    </label>`).join('')}
  </div></fieldset>`;
}

function categoryModal(id, fromEditor = false) {
  const category = state.book.categories.find((entry) => entry.id === id);
  openModal(category ? 'Edit category' : 'Add category', `<form id="category-form" data-id="${escape(id)}" ${fromEditor ? 'data-from-editor' : ''}>
    <label class="field">Name<input name="name" required maxlength="80" placeholder="e.g. Desserts" value="${escape(category?.name)}" autofocus></label>
    ${renderCategoryIcons(category)}
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions">${category ? `<button type="button" class="button button-ghost modal-delete" data-shell="delete-category" data-id="${escape(id)}">${icon('trash', 17)} Delete</button>` : '<button type="button" class="button button-secondary" data-shell="close-modal">Cancel</button>'}
      <button type="submit" class="button button-primary">Save</button></div></form>`);
  modal.querySelector('input').focus();
}

function importModal(recipes = false) {
  if (recipes) {
    openModal('Import recipes', `<form id="recipe-import-form">
      <p class="modal-copy">Choose one or more recipe export files. Any photos in the files will be imported with the recipes.</p>
      <label class="field">Recipe files<input name="files" type="file" accept=".json,application/json" multiple required autofocus></label>
      <label class="field">Target category
        <select name="categoryId">
          <option value="">No category</option>
          ${state.book.categories.map(({ id, name }) => `<option value="${escape(id)}" ${state.categoryId === id ? 'selected' : ''}>${escape(name)}</option>`).join('')}
        </select>
      </label>
      <p class="import-progress muted" role="status"></p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="button button-secondary" data-shell="close-modal">Cancel</button><button type="submit" class="button button-primary">Import</button></div>
    </form>`);
    return;
  }
  openModal('Import cookbook', `<form id="import-form">
    <p class="modal-copy">Choose a cookbook export containing recipes, photos and cooking history.</p>
    <label class="field">File<input name="file" type="file" accept=".json,application/json" required autofocus></label>
    <fieldset class="import-options"><legend>Import mode</legend>
      <label><input type="radio" name="mode" value="merge" checked><span><strong>Merge</strong><small>Keep existing recipes and add new ones.</small></span></label>
      <label><input type="radio" name="mode" value="replace"><span><strong>Restore</strong><small>Replace the cookbook with the contents of this file.</small></span></label>
    </fieldset>
    <label id="replace-confirmation" class="replace-confirmation" hidden><input name="replaceAccepted" type="checkbox"> Replace my current cookbook.</label>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="button button-secondary" data-shell="close-modal">Cancel</button><button type="submit" class="button button-primary">Import</button></div>
  </form>`);
}

function checkImportFile(file) {
  if (!file?.size) throw new Error('The file is empty.');
  const limit = state.book.limits?.maxImportBytes;
  if (limit && file.size > limit) throw new Error(`The export file can be up to ${(limit / 1024 ** 2).toLocaleString('en-GB')} MiB.`);
}

async function importRecipes(form) {
  if (form.hasAttribute('data-importing')) return;
  const fields = new FormData(form);
  const files = fields.getAll('files');
  const categoryId = fields.get('categoryId');
  const query = new URLSearchParams({ mode: 'recipe', categoryId });
  const progress = form.querySelector('.import-progress');
  const error = form.querySelector('.form-error');
  const controls = modal.querySelectorAll('button, input, select');
  form.setAttribute('data-importing', '');
  controls.forEach((control) => { control.disabled = true; });
  error.hidden = true;
  let imported = 0;
  let skipped = 0;
  const failures = [];
  try {
    for (const [index, file] of files.entries()) {
      progress.textContent = `Importing file ${index + 1} of ${files.length}…`;
      try {
        checkImportFile(file);
        const result = await request('POST', `/api/import?${query}`, file);
        if (result.importedRecipes) imported++;
        else skipped++;
      } catch (failure) {
        failures.push(`${file.name}: ${failure.message}`);
      }
      if (!form.isConnected) return;
    }
    if (imported) await refresh();
    const summary = `${imported} ${imported === 1 ? 'recipe' : 'recipes'} imported${skipped ? `, ${skipped} already in this category` : ''}.`;
    if (failures.length) {
      progress.textContent = summary;
      error.textContent = failures.join('\n');
      error.hidden = false;
      return;
    }
    closeModal();
    if (categoryId) navigate('library', categoryId);
    else if (state.categoryId) navigate('library', 'ohne');
    toast(summary);
  } catch (failure) {
    if (form.isConnected) {
      progress.textContent = '';
      error.textContent = failure.message;
      error.hidden = false;
    }
  } finally {
    controls.forEach((control) => { control.disabled = false; });
    form.removeAttribute('data-importing');
  }
}

async function handleSubmit(form) {
  const error = form.querySelector('.form-error');
  const submit = form.querySelector('button[type="submit"]');
  const fields = new FormData(form);
  error.hidden = true;
  submit.disabled = true;
  try {
    if (form.id === 'category-form') {
      const id = form.dataset.id;
      const editor = form.hasAttribute('data-from-editor') ? state.editor : null;
      const saved = await request(id ? 'PUT' : 'POST', id ? `/api/categories/${encodeURIComponent(id)}` : '/api/categories', {
        name: fields.get('name').trim(), icon: fields.get('icon') || null,
      });
      if (id) state.book.categories = state.book.categories.map((category) => category.id === saved.id ? saved : category);
      else state.book.categories.push(saved);
      const assignToEditor = editor && state.view === 'editor' && state.editor === editor;
      if (assignToEditor) editor.categoryId = saved.id;
      if (form.isConnected) closeModal();
      render();
      if (assignToEditor && !modal.open) main.querySelector('#recipe-category')?.focus({ preventScroll: true });
      toast(id ? 'Category saved.' : 'Category added.');
    } else {
      const mode = fields.get('mode');
      const file = fields.get('file');
      checkImportFile(file);
      submit.textContent = 'Importing…';
      await request('POST', `/api/import?mode=${mode}`, file);
      if (form.isConnected) closeModal();
      await refresh();
      if (mode === 'replace' || state.view === 'editor' || state.view === 'cook') navigate('library');
      toast(mode === 'replace' ? 'Cookbook restored.' : 'Cookbook imported.');
    }
  } catch (failure) {
    if (modal.open && error.isConnected) {
      error.textContent = failure.message;
      error.hidden = false;
    } else toast(failure.message, 'error');
  } finally {
    submit.disabled = false;
    if (form.id === 'import-form') submit.textContent = 'Import';
  }
}

async function deleteCategory(id) {
  const category = state.book.categories.find((entry) => entry.id === id);
  if (!category) return;
  closeModal();
  if (!await confirm(`Delete “${category.name}”? Its recipes will move to Uncategorized.`)) return;
  try {
    await request('DELETE', `/api/categories/${encodeURIComponent(id)}`);
    await refresh();
    toast('Category deleted.');
  } catch (error) { toast(error.message, 'error'); }
}

async function loadBook() {
  state.loading = true;
  state.error = '';
  render();
  try { await refresh(); }
  catch (error) {
    if (state.auth === 'login' || state.auth === 'setup') return;
    state.loading = false;
    state.error = error.message;
    render();
    setBusy(false);
  }
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    if (nav.dataset.nav === 'library' && (nav.dataset.id || null) === state.categoryId && state.view === 'library') {
      state.sidebarOpen = false;
      state.query = '';
      render();
    } else navigate(nav.dataset.nav, nav.dataset.id, nav.dataset.step);
    return;
  }
  if (event.target.closest('.skip-link')) {
    event.preventDefault();
    main.focus();
    return;
  }
  const target = event.target.closest('[data-shell]');
  if (!target) return;
  const { shell, id } = target.dataset;
  if (shell === 'toggle-sidebar') {
    state.sidebarOpen = !state.sidebarOpen;
    renderTopbar();
    renderSidebar();
    if (state.sidebarOpen) sidebar.querySelector('a')?.focus();
    else topbar.querySelector('.mobile-menu')?.focus();
  } else if (shell === 'add-category') categoryModal();
  else if (shell === 'add-recipe-category') categoryModal(null, true);
  else if (shell === 'edit-category') categoryModal(id);
  else if (shell === 'delete-category') void deleteCategory(id);
  else if (shell === 'import-book') importModal();
  else if (shell === 'import-recipe') importModal(true);
  else if (shell === 'logout') void logout(target);
  else if (shell === 'close-modal') closeModal();
  else if (shell === 'confirm-modal') closeModal(true);
  else if (shell === 'retry') void loadBook();
  else if (shell === 'clear-search') {
    const input = document.querySelector('#recipe-search');
    input.value = '';
    state.query = '';
    renderResults();
    input.focus();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'recipe-search') {
    state.query = event.target.value;
    renderResults();
  }
  if (event.target.id === 'recipe-sort') {
    state.sort = event.target.value;
    renderResults();
  }
  if (event.target.name === 'mode' && event.target.form?.id === 'import-form') {
    const checkbox = modal.querySelector('[name="replaceAccepted"]');
    checkbox.required = event.target.value === 'replace';
    checkbox.checked = false;
    checkbox.closest('label').hidden = !checkbox.required;
  }
});

modal.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'recipe-import-form') void importRecipes(event.target);
  else void handleSubmit(event.target);
});
main.addEventListener('submit', (event) => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  void submitAuth(event.target);
});
modal.addEventListener('cancel', (event) => {
  event.preventDefault();
  if (!modal.querySelector('#recipe-import-form[data-importing]')) closeModal();
});
window.addEventListener('hashchange', applyRoute);
window.addEventListener('popstate', applyRoute);
applyRoute();
void loadBook();
