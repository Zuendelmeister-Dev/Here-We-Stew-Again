export const difficultyLabels = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export const sortOptions = [
  ['added', 'Added order'],
  ['cooked-newest', 'Recently cooked'],
  ['cooked-oldest', 'Least recently cooked'],
  ['time-shortest', 'Cooking time: shortest'],
  ['time-longest', 'Cooking time: longest'],
  ['title', 'Name: A–Z'],
  ['rating', 'Highest rated'],
];

const titleOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function timedMinutes(steps) {
  return steps.reduce((total, step) => total + step.minutes, 0);
}

export function sortRecipes(recipes, order, lastCooked) {
  if (order === 'added') return recipes;
  if (order === 'title') return [...recipes].sort((a, b) => titleOrder.compare(a.title, b.title));
  const value = {
    'cooked-newest': (recipe) => lastCooked.get(recipe.id),
    'cooked-oldest': (recipe) => lastCooked.get(recipe.id),
    'time-shortest': (recipe) => timedMinutes(recipe.steps) || null,
    'time-longest': (recipe) => timedMinutes(recipe.steps) || null,
    rating: (recipe) => recipe.rating,
  }[order];
  const direction = ['cooked-oldest', 'time-shortest'].includes(order) ? 1 : -1;
  return recipes.map((recipe) => ({ recipe, key: value(recipe) })).sort((a, b) => {
    if (a.key === b.key || (a.key == null && b.key == null)) return 0;
    if (a.key == null) return 1;
    if (b.key == null) return -1;
    return a.key < b.key ? -direction : direction;
  }).map(({ recipe }) => recipe);
}

export function recipeTraits(recipe, { icon }) {
  const difficulty = difficultyLabels[recipe.difficulty];
  if (!difficulty && !recipe.rating) return '';
  return `<div class="recipe-traits">
    ${difficulty ? `<span>${difficulty}</span>` : ''}
    ${recipe.rating ? `<span class="recipe-rating" title="Personal rating">${icon('star', 15)} <span class="visually-hidden">Rated </span>${recipe.rating}/5</span>` : ''}
  </div>`;
}
