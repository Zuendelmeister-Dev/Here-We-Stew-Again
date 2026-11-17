const MAX_REGISTER_TABS = 9;

export function renderBookHero(book, featuredRecipe, { escape, icon }) {
  const { categories, recipes } = book;
  const category = featuredRecipe && categories.find(({ id }) => id === featuredRecipe.categoryId);
  const photo = featuredRecipe?.images?.[0];
  const register = Math.min(categories.length, MAX_REGISTER_TABS);
  const photograph = register ? `/images/register-${String(register).padStart(2, '0')}.jpg` : '/images/kochbuch.jpg';
  const featured = featuredRecipe ? `
    <a class="hero-book-action" href="#recipe/${encodeURIComponent(featuredRecipe.id)}" data-nav="detail" data-id="${escape(featuredRecipe.id)}" aria-label="Open ${escape(featuredRecipe.title)}">
      <div class="hero-leaf-feature${photo ? '' : ' without-photo'}">
        ${category ? `<span class="hero-leaf-category">${escape(category.name)}</span>` : ''}
        <strong class="hero-leaf-title">${escape(featuredRecipe.title)}</strong>
        ${photo ? `<img class="hero-leaf-photo" src="${escape(photo.url)}" alt="" decoding="async">` : ''}
        <span class="hero-leaf-action">Open recipe ${icon('arrow-right', 13)}</span>
      </div>
    </a>` : '<span class="hero-leaf-feature hero-leaf-empty">No recipes yet</span>';

  return `<section class="book-hero" aria-labelledby="book-title">
    <div class="hero-content">
      <h1 id="book-title">My Cookbook</h1>
      <p>Collect recipes and rediscover your favourites.</p>
      <a class="button hero-button" href="#new-recipe" data-nav="editor">${icon('plus', 19)} Add recipe</a>
    </div>
    <div class="hero-scene-frame">
      <div class="hero-scene" style="--book-photo:url('${photograph}')">
        <div class="hero-leaf-summary" aria-hidden="true">
          <span>${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}</span>
          <span>${categories.length} ${categories.length === 1 ? 'category' : 'categories'}</span>
        </div>
        ${featured}
      </div>
    </div>
  </section>`;
}
