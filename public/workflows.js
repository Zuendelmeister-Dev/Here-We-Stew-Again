import { difficultyLabels, timedMinutes } from './recipes.js';

const MAX_IMAGES = 12;
const MiB = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * MiB;
const MAX_STEPS = 100;
const MAX_INGREDIENTS = 200;
const MAX_INGREDIENT_LENGTH = 500;
const IMAGE_TYPES = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const fullDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });
const weekdayDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' });
const monthDate = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const minuteTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const sizeFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

function uploadLimits(book) {
  const count = book.limits?.maxImages ?? MAX_IMAGES;
  const bytes = book.limits?.maxImageBytes ?? MAX_IMAGE_BYTES;
  const description = bytes >= MiB ? `${sizeFormatter.format(bytes / MiB)} MiB` : `${sizeFormatter.format(bytes)} Bytes`;
  return { count, bytes, description };
}

function activeRecipe(state) {
  return state.book.recipes.find((recipe) => recipe.id === state.recipeId);
}

function localDate(key) {
  return new Date(`${key}T12:00:00`);
}

function calendarDate(year, month, day = 1) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

function elapsedDays(today, date) {
  return Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
}

function emptyRecipe({ icon }) {
  return `<section class="workflow-page section-card">
    <h1>Recipe not found</h1>
    <p>This recipe is no longer in the cookbook.</p>
    <button type="button" class="button button-secondary" data-wf-action="library">${icon('arrow-left')} Back to cookbook</button>
  </section>`;
}

function action(label, name, iconName, { icon }, options = {}) {
  const { variant = 'secondary', extra = '' } = options;
  return `<button type="button" class="button button-${variant}" data-wf-action="${name}" ${extra}>${icon(iconName)} <span>${label}</span></button>`;
}

function iconAction(label, name, iconName, { icon, escape }, extra = '') {
  return `<button type="button" class="icon-button" data-wf-action="${name}" aria-label="${escape(label)}" title="${escape(label)}" ${extra}>${icon(iconName)}</button>`;
}

function back(label, name, { icon }) {
  return `<button type="button" class="workflow-back" data-wf-action="${name}">${icon('arrow-left')} ${label}</button>`;
}

function imageSource(source, escape) {
  const allowed = /^(?:\/(?![\\/])|data:image\/(?:avif|gif|jpeg|png|webp);base64,)/i;
  return allowed.test(source ?? '') ? escape(source) : '';
}

function ratingField(rating, { icon }, saveImmediately = false) {
  return `<fieldset class="field rating-field" ${saveImmediately ? 'data-wf-rating' : ''}>
    <legend>Your rating${saveImmediately ? '' : ' <span class="muted">(optional)</span>'}</legend>
    <div class="rating-options">
      ${[1, 2, 3, 4, 5].map((stars) => {
        const label = `${stars} ${stars === 1 ? 'star' : 'stars'}`;
        return `<label class="rating-star" title="${label}">
          <input class="visually-hidden" type="radio" name="rating" value="${stars}" ${rating === stars ? 'checked' : ''}>
          <span>${icon('star', 22)}<span class="visually-hidden">${label}</span></span>
        </label>`;
      }).join('')}
      <label class="rating-clear"><input class="visually-hidden" type="radio" name="rating" value="" ${rating === null ? 'checked' : ''}><span>Unrated</span></label>
    </div>
  </fieldset>`;
}

export function renderDetail(state, helpers) {
  const { escape, icon, categoryIcon, dateKey } = helpers;
  const recipe = activeRecipe(state);
  if (!recipe) return emptyRecipe(helpers);

  const today = dateKey(new Date());
  const last = state.book.history
    .filter((entry) => entry.recipeId === recipe.id && entry.date <= today)
    .map((entry) => entry.date)
    .sort()
    .at(-1);
  const days = last ? elapsedDays(today, last) : null;
  const lastLabel = days === 0 ? 'today' : days === 1 ? '1 day ago' : days > 1 ? `${days} days ago` : '';
  const category = state.book.categories.find((item) => item.id === recipe.categoryId);
  const difficulty = difficultyLabels[recipe.difficulty];
  const [cover, ...photos] = recipe.images;
  const stepMinutes = timedMinutes(recipe.steps);

  return `<section class="workflow-page detail-page">
    <div class="workflow-header">
      ${back('Back to cookbook', 'library', helpers)}
      <div class="workflow-actions">
        <a class="button button-secondary" href="${recipePath(recipe.id)}/export" download title="Export JSON with all photos">${icon('download', 18)} Export recipe</a>
        ${action('Edit', 'edit', 'pencil', helpers)}
        ${iconAction('Delete recipe', 'delete', 'trash', helpers)}
      </div>
    </div>

    <div class="detail-hero section-card ${cover ? 'has-image' : ''}">
      <div class="detail-intro">
        <div class="detail-category">${icon(categoryIcon(category), 15)} ${escape(category?.name ?? 'Uncategorized')}</div>
        <h1>${escape(recipe.title)}</h1>
        ${recipe.description ? `<p class="detail-description">${escape(recipe.description)}</p>` : ''}
        ${stepMinutes > 0 ? `<div class="detail-duration">${icon('timer', 17)} ${stepMinutes} min timed</div>` : ''}
        ${difficulty ? `<p class="detail-difficulty">${difficulty}</p>` : ''}
        ${ratingField(recipe.rating ?? null, helpers, true)}
        <div class="workflow-actions">
          ${recipe.steps.length ? action('Start cooking', 'start-cook', 'play', helpers, { variant: 'primary' }) : ''}
          ${action(days === 0 ? 'Logged for today' : 'Mark as cooked today', 'mark-cooked', 'check', helpers, { extra: days === 0 ? 'disabled' : '' })}
        </div>
        ${last ? `<p class="detail-last-cooked" tabindex="-1">${icon('calendar', 16)} Last cooked on <time datetime="${escape(last)}">${fullDate.format(localDate(last))}</time>${lastLabel ? ` <span>· ${lastLabel}</span>` : ''}</p>` : ''}
      </div>
      ${cover ? `<img class="detail-cover" src="${imageSource(cover.url, escape)}" alt="${escape(recipe.title)}">` : ''}
    </div>

    <div class="detail-content">
      <section class="section-card detail-ingredients">
        <h2>${icon('utensils', 20)} Ingredients</h2>
        ${recipe.ingredients.length ? `<ul>${recipe.ingredients.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p class="muted">No ingredients added.</p>'}
      </section>
      <section class="section-card detail-preparation">
        <h2>${icon('chef', 21)} Directions</h2>
        ${recipe.steps.length ? `<ol class="detail-steps">${recipe.steps.map((step, index) => `
          <li>
            <a class="detail-step-link" href="#cook/${encodeURIComponent(recipe.id)}/${index + 1}" data-nav="cook" data-id="${escape(recipe.id)}" data-step="${index + 1}">
              <span class="visually-hidden">Open step ${index + 1} in cooking mode. </span>
              <span class="step-number" aria-hidden="true">${index + 1}</span>
              <span class="detail-step-copy"><span class="detail-step-text">${escape(step.text)}</span>
                ${step.minutes ? `<span class="step-duration">${icon('timer', 14)} ${step.minutes} min</span>` : ''}</span>
              <span class="detail-step-open">${icon('play', 16)}</span>
            </a>
          </li>`).join('')}</ol>` : '<p class="muted">No steps added.</p>'}
      </section>
      ${recipe.notes ? `<section class="section-card detail-notes"><h2>${icon('note', 20)} Notes</h2><p>${escape(recipe.notes)}</p></section>` : ''}
      ${photos.length ? `<section class="section-card detail-photos"><h2>${icon('camera', 20)} More photos</h2>
        <div class="detail-gallery">${photos.map((photo, index) => `<a href="${imageSource(photo.url, escape)}" target="_blank" rel="noopener" aria-label="Open full-size photo ${index + 2}"><img src="${imageSource(photo.url, escape)}" alt="${escape(photo.name || `Photo ${index + 2} of ${recipe.title}`)}" loading="lazy"></a>`).join('')}</div>
      </section>` : ''}
    </div>
  </section>`;
}

function editorDraft(state) {
  const recipe = activeRecipe(state);
  const key = recipe?.id ?? null;
  if (!state.editor || state.editor.key !== key) {
    const selectedCategory = state.book.categories.find((category) => category.id === state.categoryId);
    state.editor = {
      key,
      title: recipe?.title ?? '',
      categoryId: recipe ? recipe.categoryId ?? '' : selectedCategory?.id ?? '',
      description: recipe?.description ?? '',
      ingredients: recipe?.ingredients.length ? [...recipe.ingredients] : [''],
      steps: recipe?.steps.length ? recipe.steps.map((step) => ({ text: step.text, minutes: step.minutes || '' })) : [{ text: '', minutes: '' }],
      notes: recipe?.notes ?? '',
      difficulty: recipe?.difficulty ?? '',
      rating: recipe?.rating != null ? String(recipe.rating) : '',
      images: recipe?.images.map((image) => ({ ...image })) ?? [],
      uploading: false,
      error: '',
      photoError: '',
    };
  }
  // A category can be deleted from the sidebar while this draft stays open.
  if (state.editor.categoryId && !state.book.categories.some(({ id }) => id === state.editor.categoryId)) {
    state.editor.categoryId = '';
  }
  return state.editor;
}

function editorStep(step, index, count, helpers) {
  const { escape } = helpers;
  return `<li class="step-row" data-wf-step="${index}">
    <div class="step-row-header">
      <span class="step-number" aria-hidden="true">${index + 1}</span>
      <label for="step-text-${index}">Step ${index + 1}</label>
      <div class="step-row-actions">
        ${iconAction('Move step up', 'step-up', 'chevron-left', helpers, index === 0 ? 'disabled' : '')}
        ${iconAction('Move step down', 'step-down', 'chevron-right', helpers, index + 1 === count ? 'disabled' : '')}
        ${iconAction('Remove step', 'remove-step', 'trash', helpers)}
      </div>
    </div>
    <textarea id="step-text-${index}" name="step-text" rows="2" maxlength="4000" placeholder="Describe this step">${escape(step.text)}</textarea>
    <label class="step-time-label" for="step-time-${index}">Timer in minutes <span>(optional)</span></label>
    <input class="step-time" id="step-time-${index}" name="step-minutes" type="number" min="0" max="1440" step="1" inputmode="numeric" placeholder="0" value="${escape(step.minutes)}">
  </li>`;
}

function editorIngredient(ingredient, index, helpers) {
  const { escape } = helpers;
  return `<li class="ingredient-item" data-wf-ingredient="${index}">
    <div class="ingredient-fields">
      <input type="text" name="ingredient" id="ingredient-text-${index}" aria-label="Ingredient ${index + 1}" maxlength="${MAX_INGREDIENT_LENGTH}" placeholder="e.g. 500 g potatoes" value="${escape(ingredient)}">
      ${iconAction(`Remove ingredient ${index + 1}`, 'remove-ingredient', 'x', helpers)}
    </div>
  </li>`;
}

function editorPhoto(photo, index, helpers) {
  const { escape } = helpers;
  return `<li class="image-preview" data-wf-image="${index}">
    <img ${photo.url ? `src="${imageSource(photo.url, escape)}"` : 'data-wf-preview'} alt="${escape(photo.name || `Photo ${index + 1}`)}">
    ${index === 0 ? '<span class="image-preview-label">Cover photo</span>' : ''}
    <div class="image-preview-actions">
      ${index > 0 ? iconAction('Use as cover photo', 'cover-image', 'star', helpers) : ''}
      ${iconAction(`Remove photo ${index + 1}`, 'remove-image', 'x', helpers)}
    </div>
  </li>`;
}

export function renderEditor(state, helpers) {
  const { escape, icon } = helpers;
  if (state.recipeId && !activeRecipe(state)) return emptyRecipe(helpers);
  const draft = editorDraft(state);
  const limits = uploadLimits(state.book);
  const photoLimitReached = draft.images.length >= limits.count;
  const uploadDisabled = photoLimitReached || draft.uploading;
  const uploadLabel = draft.uploading ? 'Loading photos…' : photoLimitReached ? 'Photo limit reached'
    : draft.images.length ? 'Add more photos' : 'Choose photos';
  const saveLabel = draft.key ? 'Save changes' : 'Save recipe';

  return `<section class="workflow-page editor-page">
    <div class="workflow-header">${back(draft.key ? 'Back to recipe' : 'Back to cookbook', 'cancel-edit', helpers)}</div>
    <h1>${draft.key ? 'Edit recipe' : 'New recipe'}</h1>
    <form class="editor-form" data-wf-form>
      <div class="editor-grid">
        <div class="editor-column">
          <section class="section-card form-card">
            <h2>${icon('book', 20)} Recipe</h2>
            <label class="field" for="recipe-title">Recipe title
              <input id="recipe-title" name="title" type="text" required maxlength="160" placeholder="e.g. Creamy potato soup" value="${escape(draft.title)}">
            </label>
            <div class="field">
              <label for="recipe-category">Category</label>
              <div class="category-field-controls">
                <select id="recipe-category" name="categoryId"><option value="">Uncategorized</option>
                  ${state.book.categories.map((category) => `<option value="${escape(category.id)}" ${category.id === draft.categoryId ? 'selected' : ''}>${escape(category.name)}</option>`).join('')}
                </select>
                <button type="button" class="button button-secondary" data-shell="add-recipe-category">${icon('plus', 17)} New category</button>
              </div>
            </div>
            <label class="field" for="recipe-description">Short description <span class="muted">(optional)</span>
              <textarea id="recipe-description" name="description" rows="3" maxlength="2000" placeholder="What makes this recipe special?">${escape(draft.description)}</textarea>
            </label>
            <label class="field">Difficulty <span class="muted">(optional)</span>
              <select name="difficulty">
                <option value="">Not set</option>
                ${Object.entries(difficultyLabels).map(([value, label]) => `<option value="${value}" ${draft.difficulty === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            ${ratingField(Number(draft.rating) || null, helpers)}
          </section>
          <section class="section-card form-card">
            <h2>${icon('utensils', 20)} Ingredients</h2>
            <ul class="ingredient-list" aria-label="Ingredient list">${draft.ingredients.map((ingredient, index) => editorIngredient(ingredient, index, helpers)).join('')}</ul>
            ${action('Add ingredient', 'add-ingredient', 'plus', helpers, { extra: draft.ingredients.length >= MAX_INGREDIENTS ? 'disabled' : '' })}
          </section>
          <section class="section-card form-card">
            <h2>${icon('note', 20)} Notes</h2>
            <label class="field" for="recipe-notes">Tips, variations or reminders
              <textarea id="recipe-notes" name="notes" rows="4" maxlength="12000">${escape(draft.notes)}</textarea>
            </label>
          </section>
        </div>

        <div class="editor-column">
          <section class="section-card form-card">
            <h2>${icon('chef', 20)} Directions</h2>
            <ol class="editor-steps">${draft.steps.map((step, index) => editorStep(step, index, draft.steps.length, helpers)).join('')}</ol>
            ${action('Add step', 'add-step', 'plus', helpers, { extra: draft.steps.length >= MAX_STEPS ? 'disabled' : '' })}
          </section>
          <section class="section-card form-card">
            <h2>${icon('camera', 20)} Photos</h2>
            <p class="field-hint" id="photo-upload-hint">${draft.images.length} of ${limits.count} photos added. Select several at once or add them in batches. Each photo can be up to ${limits.description}. The first photo is the cover.</p>
            ${draft.images.length ? `<ul class="image-preview-grid">${draft.images.map((photo, index) => editorPhoto(photo, index, helpers)).join('')}</ul>` : ''}
            <label class="image-upload ${uploadDisabled ? 'is-disabled' : ''}">
              ${icon('upload', 21)} <span>${uploadLabel}</span>
              <input type="file" name="images" multiple accept=".avif,.gif,.jpg,.jpeg,.png,.webp" aria-describedby="photo-upload-hint" ${uploadDisabled ? 'disabled' : ''}>
            </label>
            <p class="form-error" role="alert" data-wf-photo-error ${draft.photoError ? '' : 'hidden'}>${escape(draft.photoError)}</p>
          </section>
        </div>
      </div>

      <p class="form-error" role="alert" data-wf-editor-error ${draft.error ? '' : 'hidden'}>${escape(draft.error)}</p>
      <div class="editor-actions workflow-actions">
        ${action('Cancel', 'cancel-edit', 'x', helpers, { variant: 'ghost' })}
        <button type="submit" class="button button-primary" ${draft.uploading ? 'disabled' : ''}>${icon('check')} ${saveLabel}</button>
      </div>
    </form>
  </section>`;
}

function cookSession(state, recipe) {
  if (!state.cook || state.cook.recipeId !== recipe.id || state.cook.index >= recipe.steps.length) {
    const index = recipe.steps[state.cookStartIndex] ? state.cookStartIndex : 0;
    state.cook = { recipeId: recipe.id, index, complete: false, timers: {} };
  }
  return state.cook;
}

function stepTimer(session, step) {
  if (!step.minutes) return null;
  const duration = step.minutes * 60_000;
  session.timers[session.index] ??= { duration, deadline: Date.now() + duration, remaining: duration };
  return session.timers[session.index];
}

function remainingTime(timer, now) {
  return timer.deadline === null ? timer.remaining : Math.max(0, timer.deadline - now);
}

function countdown(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = `${Math.floor(seconds / 60)}`.padStart(2, '0');
  return `${minutes}:${`${seconds % 60}`.padStart(2, '0')}`;
}

function timerStatus(timer, now) {
  if (!timer) return '';
  if (remainingTime(timer, now) === 0) return 'Time is up. You can move on.';
  if (timer.deadline === null) return 'Timer paused';
  return `Ready at ${minuteTime.format(timer.deadline)}`;
}

export function renderCook(state, helpers) {
  const { escape, icon } = helpers;
  const recipe = activeRecipe(state);
  if (!recipe || !recipe.steps.length) return emptyRecipe(helpers);
  const session = cookSession(state, recipe);
  const step = recipe.steps[session.index];
  const now = Date.now();
  const timer = session.complete ? null : stepTimer(session, step);
  const cookedToday = state.book.history.some((entry) => entry.recipeId === recipe.id && entry.date === helpers.dateKey(new Date()));

  return `<section class="workflow-page cook-page">
    <div class="workflow-header">${back('Back to recipe', 'detail', helpers)}</div>
    <header class="cook-header"><p class="detail-category">${icon('chef', 17)} Cooking mode</p><h1>${escape(recipe.title)}</h1></header>
    ${session.complete ? `<section class="section-card cook-card cook-complete">
      <span class="cook-complete-icon">${icon('check-circle', 42)}</span>
      <h2 tabindex="-1">Enjoy your meal!</h2>
      <p>All steps are complete.</p>
      <div class="cook-actions workflow-actions">
        ${action('Back to recipe', 'detail', 'arrow-left', helpers)}
        ${action(cookedToday ? 'Logged for today' : 'Mark as cooked today', 'mark-cooked', 'check', helpers, { variant: 'primary', extra: cookedToday ? 'disabled' : '' })}
      </div>
    </section>` : `<section class="section-card cook-card">
      <div class="cook-progress">
        <p>Step ${session.index + 1} of ${recipe.steps.length}</p>
        ${recipe.steps.length > 1 ? `<label class="cook-step-picker">Choose a step
          <select data-wf-cook-step>${recipe.steps.map((_, index) => `<option value="${index}" ${index === session.index ? 'selected' : ''}>Step ${index + 1}</option>`).join('')}</select>
        </label>` : ''}
        <progress value="${session.index + 1}" max="${recipe.steps.length}" aria-label="Cooking progress"></progress>
      </div>
      <div class="cook-step">
        <h2 tabindex="-1" data-wf-step-heading>Step ${session.index + 1}</h2><p>${escape(step.text)}</p>
      </div>
      <div class="cook-clock ${timer ? 'has-timer' : ''}">
        <div class="cook-current-time"><span>${icon('clock', 17)} Current time</span><time data-wf-clock>${minuteTime.format(now)}</time></div>
        ${timer ? `<div class="cook-timer" data-wf-timer>
          <div><span>${icon('timer', 17)} Time remaining</span><strong data-wf-countdown role="timer">${countdown(remainingTime(timer, now))}</strong>
            <p data-wf-timer-status role="status">${timerStatus(timer, now)}</p></div>
          <div class="timer-actions">
            ${iconAction(timer.deadline === null ? 'Resume timer' : 'Pause timer', 'toggle-timer', timer.deadline === null ? 'play' : 'pause', helpers, remainingTime(timer, now) > 0 ? '' : 'hidden')}
            ${iconAction('Restart timer', 'restart-timer', 'rotate', helpers)}
          </div>
        </div>` : ''}
      </div>
      <div class="cook-actions workflow-actions">
        ${action('Previous step', 'previous-step', 'arrow-left', helpers, { extra: session.index === 0 ? 'disabled' : '' })}
        ${session.index + 1 < recipe.steps.length ? action('Next step', 'next-step', 'arrow-right', helpers, { variant: 'primary' }) : action('Finish cooking', 'finish-cook', 'check', helpers, { variant: 'primary' })}
      </div>
    </section>`}
  </section>`;
}

function calendarState(state) {
  if (!state.calendar) {
    const now = new Date();
    state.calendar = { year: now.getFullYear(), month: now.getMonth(), selected: null };
  }
  return state.calendar;
}

export function renderCalendar(state, helpers) {
  const { escape, icon, dateKey } = helpers;
  const { year, month, selected } = calendarState(state);
  const first = calendarDate(year, month);
  const firstColumn = (first.getDay() + 6) % 7;
  const monthLength = calendarDate(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstColumn + monthLength) / 7) * 7;
  const today = dateKey(new Date());
  const grouped = new Map();
  const recipes = new Map(state.book.recipes.map((recipe) => [recipe.id, recipe]));
  for (const entry of state.book.history) {
    if (!recipes.has(entry.recipeId)) continue;
    const items = grouped.get(entry.date) ?? [];
    items.push(recipes.get(entry.recipeId));
    grouped.set(entry.date, items);
  }

  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = calendarDate(year, month, index - firstColumn + 1);
    const key = dateKey(date);
    const items = grouped.get(key) ?? [];
    const description = items.length ? `, ${items.length} ${items.length === 1 ? 'meal' : 'meals'} cooked` : '';
    const classes = ['calendar-day', date.getMonth() !== month ? 'outside-month' : '', key === today ? 'is-today' : '', items.length ? 'has-entries' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-wf-action="select-day" data-date="${key}" aria-label="${weekdayDate.format(date)}${description}" aria-pressed="${key === selected}" ${key === today ? 'aria-current="date"' : ''}><span>${date.getDate()}</span>${items.length ? `<span class="calendar-marker" aria-hidden="true">${items.length > 1 ? items.length : ''}</span>` : ''}</button>`;
  }).join('');

  const prefix = dateKey(first).slice(0, 7);
  const visibleDays = selected ? [selected] : [...grouped.keys()].filter((key) => key.startsWith(prefix)).sort().reverse();
  const visibleEntries = visibleDays.filter((key) => grouped.has(key));

  return `<section class="workflow-page calendar-page">
    <header class="calendar-header"><h1>Cooking Calendar</h1></header>
    <div class="calendar-layout">
      <section class="section-card calendar-card" aria-label="Month view">
        <header class="calendar-toolbar">
          <h2>${monthDate.format(first)}</h2>
          <div class="calendar-controls">
            <button type="button" class="button button-secondary" data-wf-action="calendar-today">Today</button>
            ${iconAction('Previous month', 'previous-month', 'chevron-left', helpers)}
            ${iconAction('Next month', 'next-month', 'chevron-right', helpers)}
          </div>
        </header>
        <div class="calendar-grid">
          ${[['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']].map(([short, full]) => `<span class="calendar-weekday" aria-label="${full}">${short}</span>`).join('')}
          ${cells}
        </div>
      </section>
      <section class="section-card calendar-history">
        <header class="calendar-history-header">
          <h2>${icon('utensils', 20)} ${selected ? fullDate.format(localDate(selected)) : 'This month'}</h2>
          ${selected ? `<button type="button" class="button button-ghost" data-wf-action="clear-day">Show whole month</button>` : ''}
        </header>
        ${visibleEntries.length ? visibleEntries.map((key) => `<div class="history-day">
          ${selected ? '' : `<h3>${fullDate.format(localDate(key))}</h3>`}
          <ul class="history-list">${grouped.get(key).map((recipe) => `<li data-recipe-id="${escape(recipe.id)}" data-date="${key}">
            <a href="#recipe/${encodeURIComponent(recipe.id)}" data-wf-action="history-recipe">${escape(recipe.title)} ${icon('chevron-right', 15)}</a>
            ${iconAction(`Remove cooking entry for ${recipe.title}`, 'remove-history', 'trash', helpers)}
          </li>`).join('')}</ul>
        </div>`).join('') : `<p class="muted calendar-empty">${selected ? 'No meals logged on this day.' : 'No meals logged this month.'}</p>`}
      </section>
    </div>
  </section>`;
}

function fileType(file) {
  const allowed = Object.values(IMAGE_TYPES);
  if (allowed.includes(file.type)) return file.type;
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!file.type && Object.hasOwn(IMAGE_TYPES, extension)) return IMAGE_TYPES[extension];
  return null;
}

function readPhoto(file, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve({ name: file.name.slice(0, 255), dataUrl: reader.result }));
    reader.addEventListener('error', () => reject(new Error(`Could not read “${file.name}”.`)));
    reader.readAsDataURL(new Blob([file], { type }));
  });
}

async function loadPhotos(files, draft, limits) {
  if (draft.images.length + files.length > limits.count) {
    throw new Error(`You can add up to ${limits.count} photos per recipe.`);
  }
  const photos = [];
  const errors = [];
  for (const file of files) {
    try {
      if (!file.size) throw new Error(`“${file.name}” is empty.`);
      if (file.size > limits.bytes) throw new Error(`“${file.name}” is larger than ${limits.description}.`);
      const type = fileType(file);
      if (!type) throw new Error(`“${file.name}” has an unsupported image format. Use JPEG, PNG, WebP, GIF or AVIF.`);
      photos.push(await readPhoto(file, type));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { photos, errors };
}

function recipePath(id) {
  return `/api/recipes/${encodeURIComponent(id)}`;
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function bindClock(root, state) {
  const clock = root.querySelector('[data-wf-clock]');
  if (!clock || state.view !== 'cook') return null;
  const countdownElement = root.querySelector('[data-wf-countdown]');
  const status = root.querySelector('[data-wf-timer-status]');
  const pause = root.querySelector('[data-wf-action="toggle-timer"]');
  const timer = state.cook.timers[state.cook.index];
  const tick = () => {
    const now = Date.now();
    setText(clock, minuteTime.format(now));
    if (timer && countdownElement) {
      const remaining = remainingTime(timer, now);
      setText(countdownElement, countdown(remaining));
      setText(status, timerStatus(timer, now));
      pause.hidden = remaining === 0;
    }
  };
  tick();
  return window.setInterval(tick, 250);
}

export function bindWorkflows(root, state, helpers) {
  const { render, navigate, request, refresh, toast, dateKey, confirm, setBusy } = helpers;
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const interval = bindClock(root, state);

  for (const preview of root.querySelectorAll('[data-wf-preview]')) {
    const index = Number(preview.closest('[data-wf-image]').dataset.wfImage);
    preview.src = state.editor.images[index].dataUrl;
  }

  function renderAndFocus(selector, preventScroll = true) {
    render();
    root.querySelector(selector)?.focus({ preventScroll });
  }

  function showError(error) {
    toast(error?.message || 'Could not save the change.', 'error');
  }

  function editorError(draft, message) {
    if (state.editor !== draft || state.view !== 'editor') return;
    draft.error = message;
    const alert = root.querySelector('[data-wf-editor-error]');
    if (alert) {
      alert.hidden = !message;
      alert.textContent = message;
    }
  }

  async function mutate(operation) {
    if (state.workflowPending) return;
    state.workflowPending = true;
    setBusy(true);
    try {
      await operation();
    } finally {
      state.workflowPending = false;
      setBusy(false);
    }
  }

  async function saveDraft(draft) {
    editorError(draft, '');
    if (!draft.title.trim()) throw new Error('Enter a title for the recipe.');
    if (draft.steps.some((step) => !step.text.trim() && Number(step.minutes) > 0)) {
      throw new Error('Add instructions for the step with a timer.');
    }
    const body = {
      title: draft.title.trim(),
      categoryId: draft.categoryId || null,
      description: draft.description.trim(),
      ingredients: draft.ingredients.map((item) => item.trim()).filter(Boolean),
      steps: draft.steps.filter((step) => step.text.trim()).map((step) => ({ text: step.text.trim(), minutes: Number(step.minutes) })),
      notes: draft.notes.trim(),
      difficulty: draft.difficulty || null,
      rating: draft.rating ? Number(draft.rating) : null,
      images: draft.images.map((photo) => photo.id ? { id: photo.id } : { name: photo.name, dataUrl: photo.dataUrl }),
    };
    await mutate(async () => {
      const result = await request(draft.key ? 'PUT' : 'POST', draft.key ? recipePath(draft.key) : '/api/recipes', body);
      const saved = draft.key ? 'Changes saved.' : 'Recipe added.';
      let refreshFailed = false;
      try { await refresh(); }
      catch { refreshFailed = true; }
      if (state.view === 'editor' && state.editor === draft) {
        state.editor = null;
        navigate('detail', result.id);
      }
      toast(refreshFailed ? `${saved} Reload the page to see the latest version.` : saved);
    });
  }

  async function recordCooking(id) {
    await mutate(async () => {
      await request('POST', `${recipePath(id)}/cooked`, { date: dateKey(new Date()) });
      await refresh();
      if (state.recipeId === id) root.querySelector('.detail-last-cooked, .cook-complete [data-wf-action="detail"]')?.focus({ preventScroll: true });
      toast('Logged in the cooking calendar for today.');
    });
  }

  async function saveRating(group, field) {
    const recipe = activeRecipe(state);
    if (!recipe) return;
    const rating = field.value === '' ? null : Number(field.value);
    const previous = group.querySelector(`input[value="${recipe.rating ?? ''}"]`);
    if (state.workflowPending) {
      previous.checked = true;
      return;
    }

    const { ownerDocument } = field;
    const wasFocused = ownerDocument.activeElement === field;
    group.disabled = true;
    try {
      await mutate(async () => {
        const saved = await request('PATCH', `${recipePath(recipe.id)}/rating`, { rating });
        const current = state.book.recipes.find(({ id }) => id === recipe.id);
        if (!current) return;
        current.rating = saved.rating;
        if (state.view === 'library' || (state.view === 'detail' && state.recipeId === recipe.id && !group.isConnected)) render();
        toast(saved.rating === null ? 'Rating cleared.' : 'Rating saved.');
      });
    } catch (error) {
      previous.checked = true;
      toast(error.message || 'Could not save the rating.', 'error');
    } finally {
      group.disabled = false;
      if (wasFocused && group.isConnected && ownerDocument.activeElement === ownerDocument.body) {
        group.querySelector('input:checked')?.focus({ preventScroll: true });
      }
    }
  }

  async function removeRecipe(recipe) {
    if (!await confirm(`Delete “${recipe.title}” and all its photos and cooking history?`)) return;
    await mutate(async () => {
      await request('DELETE', recipePath(recipe.id));
      if (state.recipeId === recipe.id) navigate('library');
      await refresh();
      toast('Recipe deleted.');
    });
  }

  async function removeHistory(id, date) {
    if (!await confirm(`Remove the cooking entry for ${fullDate.format(localDate(date))}?`)) return;
    await mutate(async () => {
      await request('DELETE', `${recipePath(id)}/cooked?date=${encodeURIComponent(date)}`);
      await refresh();
      toast('Cooking entry removed.');
    });
  }

  function addIngredient() {
    const { ingredients } = state.editor;
    if (ingredients.length >= MAX_INGREDIENTS) return;
    ingredients.push('');
    renderAndFocus(`#ingredient-text-${ingredients.length - 1}`, false);
  }

  function removeIngredient(button) {
    const { ingredients } = state.editor;
    const index = Number(button.closest('[data-wf-ingredient]').dataset.wfIngredient);
    ingredients.splice(index, 1);
    if (!ingredients.length) ingredients.push('');
    renderAndFocus(`#ingredient-text-${Math.min(index, ingredients.length - 1)}`, false);
  }

  function changeStep(actionName, button) {
    const { steps } = state.editor;
    const index = Number(button.closest('[data-wf-step]')?.dataset.wfStep);
    let target = index;
    switch (actionName) {
      case 'add-step':
        if (steps.length >= MAX_STEPS) return;
        target = steps.length;
        steps.push({ text: '', minutes: '' });
        break;
      case 'remove-step':
        steps.splice(index, 1);
        if (!steps.length) steps.push({ text: '', minutes: '' });
        target = Math.min(index, steps.length - 1);
        break;
      case 'step-up':
      case 'step-down': {
        target = index + (actionName === 'step-up' ? -1 : 1);
        const [step] = steps.splice(index, 1);
        steps.splice(target, 0, step);
        break;
      }
    }
    renderAndFocus(`#step-text-${target}`, false);
  }

  function changePhoto(actionName, button) {
    const index = Number(button.closest('[data-wf-image]').dataset.wfImage);
    const { images } = state.editor;
    const [photo] = images.splice(index, 1);
    if (actionName === 'cover-image') images.unshift(photo);
    renderAndFocus('[name="images"]');
  }

  function changeCookStep(nextIndex, focus = '[data-wf-step-heading]') {
    const session = state.cook;
    if (nextIndex === session.index || (nextIndex !== null && !activeRecipe(state)?.steps[nextIndex])) return;
    const timer = session.timers[session.index];
    if (timer && timer.deadline !== null) {
      timer.remaining = remainingTime(timer, Date.now());
      timer.deadline = null;
    }
    if (nextIndex === null) session.complete = true;
    else session.index = nextIndex;
    renderAndFocus(session.complete ? '.cook-complete h2' : focus, false);
  }

  function changeTimer(actionName) {
    const timer = state.cook.timers[state.cook.index];
    const now = Date.now();
    if (actionName === 'restart-timer') {
      timer.remaining = timer.duration;
      timer.deadline = now + timer.duration;
    } else if (timer.deadline === null) {
      timer.deadline = now + timer.remaining;
    } else {
      timer.remaining = remainingTime(timer, now);
      timer.deadline = null;
    }
    renderAndFocus(`[data-wf-action="${actionName}"]`);
  }

  function changeCalendar(actionName, button) {
    const calendar = calendarState(state);
    let date = calendarDate(calendar.year, calendar.month);
    if (actionName === 'select-day') {
      date = localDate(button.dataset.date);
      calendar.selected = calendar.selected === button.dataset.date ? null : button.dataset.date;
    } else if (actionName === 'calendar-today') {
      date = new Date();
      calendar.selected = dateKey(date);
    } else {
      if (actionName === 'next-month') date.setMonth(calendar.month + 1);
      if (actionName === 'previous-month') date.setMonth(calendar.month - 1);
      calendar.selected = null;
    }
    calendar.year = date.getFullYear();
    calendar.month = date.getMonth();
    const focusAction = actionName === 'clear-day' ? 'calendar-today' : actionName;
    const selector = actionName === 'select-day' ? `[data-date="${dateKey(date)}"]` : `[data-wf-action="${focusAction}"]`;
    renderAndFocus(selector);
  }

  async function handleClick(event) {
    const button = event.target.closest?.('[data-wf-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.tagName === 'A' && (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) return;
    event.preventDefault();
    if (state.workflowPending) return;

    const actionName = button.dataset.wfAction;
    switch (actionName) {
      case 'library':
        navigate('library', state.categoryId);
        break;
      case 'detail':
        navigate('detail', state.recipeId);
        break;
      case 'edit':
        navigate('editor', state.recipeId);
        break;
      case 'cancel-edit': {
        const key = state.editor?.key;
        state.editor = null;
        navigate(key ? 'detail' : 'library', key || state.categoryId);
        break;
      }
      case 'delete':
        await removeRecipe(activeRecipe(state));
        break;
      case 'mark-cooked':
        await recordCooking(state.recipeId);
        break;
      case 'add-ingredient':
        addIngredient();
        break;
      case 'remove-ingredient':
        removeIngredient(button);
        break;
      case 'add-step':
      case 'remove-step':
      case 'step-up':
      case 'step-down':
        changeStep(actionName, button);
        break;
      case 'cover-image':
      case 'remove-image':
        changePhoto(actionName, button);
        break;
      case 'start-cook':
        navigate('cook', state.recipeId);
        break;
      case 'previous-step':
        changeCookStep(state.cook.index - 1);
        break;
      case 'next-step':
        changeCookStep(state.cook.index + 1);
        break;
      case 'finish-cook':
        changeCookStep(null);
        break;
      case 'toggle-timer':
      case 'restart-timer':
        changeTimer(actionName);
        break;
      case 'previous-month':
      case 'next-month':
      case 'select-day':
      case 'clear-day':
      case 'calendar-today':
        changeCalendar(actionName, button);
        break;
      case 'history-recipe':
        navigate('detail', button.closest('[data-recipe-id]').dataset.recipeId);
        break;
      case 'remove-history': {
        const { recipeId, date } = button.closest('[data-recipe-id]').dataset;
        await removeHistory(recipeId, date);
        break;
      }
    }
  }

  root.addEventListener('click', (event) => {
    handleClick(event).catch(showError);
  }, listenerOptions);

  root.addEventListener('submit', (event) => {
    if (!event.target.matches('[data-wf-form]')) return;
    event.preventDefault();
    const draft = state.editor;
    if (!draft || draft.uploading || state.workflowPending) return;
    saveDraft(draft).catch((error) => editorError(draft, error.message || 'Could not save the recipe.'));
  }, listenerOptions);

  root.addEventListener('input', (event) => {
    const field = event.target;
    if (!field.closest?.('[data-wf-form]') || !state.editor) return;
    const step = field.closest('[data-wf-step]');
    if (step && field.name === 'step-text') state.editor.steps[Number(step.dataset.wfStep)].text = field.value;
    if (step && field.name === 'step-minutes') state.editor.steps[Number(step.dataset.wfStep)].minutes = field.value;
    if (field.name === 'ingredient') {
      const index = Number(field.closest('[data-wf-ingredient]').dataset.wfIngredient);
      state.editor.ingredients[index] = field.value;
    }
    if (['title', 'categoryId', 'description', 'notes', 'difficulty', 'rating'].includes(field.name)) state.editor[field.name] = field.value;
  }, listenerOptions);

  root.addEventListener('keydown', (event) => {
    const field = event.target;
    if (event.key !== 'Enter' || event.isComposing || field.name !== 'ingredient' || !state.editor) return;
    event.preventDefault();
    if (state.workflowPending) return;
    const index = Number(field.closest('[data-wf-ingredient]').dataset.wfIngredient);
    const next = root.querySelector(`#ingredient-text-${index + 1}`);
    if (next) next.focus();
    else if (field.value.trim()) addIngredient();
  }, listenerOptions);

  root.addEventListener('paste', (event) => {
    const field = event.target;
    const text = event.clipboardData?.getData('text/plain');
    if (field.name !== 'ingredient' || !state.editor || state.workflowPending || !text || !/[\r\n]/.test(text)) return;
    event.preventDefault();

    const lines = text.split(/\r\n?|\n/)
      .map((line) => line.trim().replace(/^(?:[•●▪◦‣⁃]\s*|[-*]\s+)/u, ''))
      .filter(Boolean);
    if (!lines.length) return;

    const { ingredients } = state.editor;
    if (ingredients.length + lines.length - 1 > MAX_INGREDIENTS) {
      toast(`The ingredient list can contain up to ${MAX_INGREDIENTS} items.`, 'error');
      return;
    }
    lines[0] = field.value.slice(0, field.selectionStart) + lines[0];
    lines[lines.length - 1] += field.value.slice(field.selectionEnd);
    if (lines.some((line) => line.length > MAX_INGREDIENT_LENGTH)) {
      toast(`Each ingredient can contain up to ${MAX_INGREDIENT_LENGTH} characters.`, 'error');
      return;
    }

    const index = Number(field.closest('[data-wf-ingredient]').dataset.wfIngredient);
    ingredients.splice(index, 1, ...lines);
    renderAndFocus(`#ingredient-text-${index + lines.length - 1}`, false);
  }, listenerOptions);

  root.addEventListener('change', async (event) => {
    const field = event.target;
    const ratingGroup = field.closest('[data-wf-rating]');
    if (ratingGroup && field.name === 'rating') {
      await saveRating(ratingGroup, field);
      return;
    }
    if (field.matches('[data-wf-cook-step]')) {
      changeCookStep(Number(field.value), '[data-wf-cook-step]');
      return;
    }
    const draft = state.editor;
    if (field.name !== 'images' || !field.closest?.('[data-wf-form]') || !draft || draft.uploading || state.workflowPending) return;
    const files = Array.from(field.files);
    field.value = '';
    if (!files.length) return;
    draft.photoError = '';
    draft.uploading = true;
    render();
    try {
      const { photos, errors } = await loadPhotos(files, draft, uploadLimits(state.book));
      draft.images.push(...photos);
      draft.photoError = errors.join(' ');
    } catch (error) {
      draft.photoError = error.message;
    } finally {
      draft.uploading = false;
      if (state.view === 'editor' && state.editor === draft) renderAndFocus('[name="images"]');
    }
  }, listenerOptions);

  return () => {
    controller.abort();
    if (interval !== null) window.clearInterval(interval);
  };
}
