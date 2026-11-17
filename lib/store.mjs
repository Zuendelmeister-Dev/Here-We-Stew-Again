import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { categories as sampleCategories, recipes as sampleRecipes } from './samples.mjs';
import {
  BACKUP_FORMAT, BACKUP_VERSION, HttpError, checkBackup, checkCategoryIcon, checkRating, checkRecipe, checkText,
  checkTimestamp, checkUpload, requireDate, requireId, requireObject,
} from './validation.mjs';

const schema = `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    icon TEXT
  );
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    steps TEXT NOT NULL,
    notes TEXT NOT NULL,
    difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX recipes_category ON recipes(category_id);
  CREATE TABLE images (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL
  );
  CREATE INDEX images_recipe ON images(recipe_id, position);
  CREATE TABLE cooking_history (
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    PRIMARY KEY (recipe_id, date)
  );
  CREATE INDEX cooking_history_date ON cooking_history(date, recipe_id);
`;

const selectCategories = 'SELECT id, name, icon FROM categories ORDER BY rowid';
const insertCategory = 'INSERT INTO categories (id, name, name_key, icon) VALUES (?, ?, ?, ?)';
const selectRecipes = 'SELECT * FROM recipes ORDER BY created_at, rowid';
const selectHistory = 'SELECT recipe_id AS recipeId, date FROM cooking_history ORDER BY date DESC, recipe_id';

const keyForName = name => name.toLocaleLowerCase('de');
const now = () => new Date().toISOString();

function recipeData(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    ingredients: JSON.parse(row.ingredients),
    steps: JSON.parse(row.steps),
    notes: row.notes,
    difficulty: row.difficulty,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertRecipe(database, id, recipe, createdAt, updatedAt) {
  database.prepare(`
    INSERT INTO recipes (id, category_id, title, description, ingredients, steps, notes, difficulty, rating, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, recipe.categoryId, recipe.title, recipe.description, JSON.stringify(recipe.ingredients),
    JSON.stringify(recipe.steps), recipe.notes, recipe.difficulty ?? null, recipe.rating ?? null, createdAt, updatedAt);
}

function insertImage(database, recipeId, position, image, id = randomUUID()) {
  database.prepare('INSERT INTO images VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, recipeId, position, image.name, image.mime, image.contents);
}

function recipeFingerprint(recipe, images) {
  const { title, categoryId, description, ingredients, steps, notes, difficulty, rating } = recipe;
  const fields = [title, categoryId, description, ingredients, steps, notes];
  if (difficulty != null || rating != null) fields.push(difficulty, rating);
  const hash = createHash('sha256').update(JSON.stringify(fields));
  for (const { name, mime, contents } of images) {
    hash.update(JSON.stringify([name, mime, contents.byteLength])).update(contents);
  }
  return hash.digest('hex');
}

export class BookStore {
  constructor(dataDirectory, sampleImageDirectory, maxImageBytes) {
    mkdirSync(dataDirectory, { recursive: true });
    this.filename = join(dataDirectory, 'kochbuch.sqlite');
    this.database = new DatabaseSync(this.filename);
    this.maxImageBytes = maxImageBytes;
    this.database.exec('PRAGMA busy_timeout = 5000');
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.transaction(() => {
      const { user_version: version } = this.database.prepare('PRAGMA user_version').get();
      if (version === 0) {
        this.database.exec(schema);
        this.seed(sampleImageDirectory);
      } else if (version === 1) {
        this.database.exec('ALTER TABLE categories ADD COLUMN icon TEXT');
      } else if (![2, 3, 4, 5].includes(version)) {
        throw new Error('This cookbook database version is not supported.');
      }
      if (version < 3) {
        this.database.exec(`
          CREATE TABLE account (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            username TEXT NOT NULL,
            salt BLOB NOT NULL,
            password_hash BLOB NOT NULL
          );
        `);
      }
      if (version > 0 && version < 4) {
        this.database.exec(`
          ALTER TABLE recipes ADD COLUMN difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard'));
          ALTER TABLE recipes ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5);
        `);
      }
      if (version < 5) {
        this.database.exec(`
          CREATE TABLE recovery_account (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            username TEXT NOT NULL,
            salt BLOB NOT NULL,
            password_hash BLOB NOT NULL,
            generation TEXT NOT NULL
          );
          PRAGMA user_version = 5;
        `);
      }
    });
  }

  transaction(work, { readOnly = false } = {}) {
    this.database.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  seed(imageDirectory) {
    const addCategory = this.database.prepare(insertCategory);
    for (const { id, name, icon } of sampleCategories) addCategory.run(id, name, keyForName(name), icon);
    const timestamp = now();
    for (const recipe of sampleRecipes) {
      insertRecipe(this.database, recipe.id, recipe, timestamp, timestamp);
      try {
        const contents = readFileSync(join(imageDirectory, recipe.image));
        if (contents.length <= this.maxImageBytes) {
          insertImage(this.database, recipe.id, 0, { name: recipe.image, mime: 'image/jpeg', contents }, `${recipe.id}-foto`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  getBook() {
    return this.transaction(() => {
      const categories = this.database.prepare(selectCategories).all();
      const recipes = this.database.prepare(selectRecipes).all()
        .map(row => ({ ...recipeData(row), images: [] }));
      const recipesById = new Map(recipes.map(recipe => [recipe.id, recipe]));
      for (const image of this.database.prepare('SELECT id, recipe_id, name FROM images ORDER BY position').iterate()) {
        recipesById.get(image.recipe_id).images.push({
          id: image.id,
          name: image.name,
          url: `/api/images/${image.id}`,
        });
      }
      return { categories, recipes, history: this.database.prepare(selectHistory).all() };
    }, { readOnly: true });
  }

  saveCategory(value, id = null) {
    const input = requireObject(value, 'Category');
    const name = checkText(input.name, 'Category name', 80, true);
    const icon = checkCategoryIcon(input.icon);
    const key = keyForName(name);
    return this.transaction(() => {
      const existing = this.database.prepare('SELECT id FROM categories WHERE name_key = ?').get(key);
      if (existing && existing.id !== id) {
        throw new HttpError(409, 'A category with this name already exists.');
      }
      if (id === null) {
        const createdId = randomUUID();
        this.database.prepare(insertCategory).run(createdId, name, key, icon);
        return { id: createdId, name, icon };
      }
      const current = this.database.prepare('SELECT icon FROM categories WHERE id = ?').get(id);
      if (!current) throw new HttpError(404, 'This category could not be found.');
      const updatedIcon = input.icon === undefined ? current.icon : icon;
      this.database.prepare('UPDATE categories SET name = ?, name_key = ?, icon = ? WHERE id = ?')
        .run(name, key, updatedIcon, id);
      return { id, name, icon: updatedIcon };
    });
  }

  deleteCategory(id) {
    const result = this.database.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (!result.changes) throw new HttpError(404, 'This category could not be found.');
  }

  saveRecipe(value, id = null) {
    const recipe = checkRecipe(value);
    return this.transaction(() => {
      if (recipe.categoryId && !this.database.prepare('SELECT 1 FROM categories WHERE id = ?').get(recipe.categoryId)) {
        throw new HttpError(400, 'The selected category no longer exists.');
      }
      const timestamp = now();
      if (id === null) {
        id = randomUUID();
        insertRecipe(this.database, id, recipe, timestamp, timestamp);
      } else {
        const result = this.database.prepare(`
          UPDATE recipes SET category_id = ?, title = ?, description = ?, ingredients = ?, steps = ?,
            notes = ?, difficulty = ?, rating = ?, updated_at = ?
          WHERE id = ?
        `).run(recipe.categoryId, recipe.title, recipe.description, JSON.stringify(recipe.ingredients),
          JSON.stringify(recipe.steps), recipe.notes, recipe.difficulty, recipe.rating, timestamp, id);
        if (!result.changes) throw new HttpError(404, 'This recipe could not be found.');
      }
      this.updateImages(id, recipe.images);
      return id;
    });
  }

  updateImages(recipeId, images) {
    const saved = this.database.prepare('SELECT id FROM images WHERE recipe_id = ?').all(recipeId);
    const removed = new Set(saved.map(image => image.id));
    const setPosition = this.database.prepare('UPDATE images SET position = ? WHERE id = ?');
    for (const [position, value] of images.entries()) {
      const image = requireObject(value, 'Image');
      if (image.id != null) {
        const id = requireId(image.id, 'Image ID');
        if (!removed.delete(id)) throw new HttpError(400, 'An existing image is invalid or was included twice.');
        setPosition.run(position, id);
      } else {
        insertImage(this.database, recipeId, position, checkUpload(image, this.maxImageBytes));
      }
    }
    const removeImage = this.database.prepare('DELETE FROM images WHERE id = ?');
    for (const id of removed) removeImage.run(id);
  }

  deleteRecipe(id) {
    const result = this.database.prepare('DELETE FROM recipes WHERE id = ?').run(id);
    if (!result.changes) throw new HttpError(404, 'This recipe could not be found.');
  }

  setRecipeRating(id, value) {
    const rating = checkRating(value);
    const result = this.database.prepare('UPDATE recipes SET rating = ? WHERE id = ?').run(rating, id);
    if (!result.changes) throw new HttpError(404, 'This recipe could not be found.');
    return rating;
  }

  setCooked(id, date, markCooked) {
    requireDate(date);
    this.transaction(() => {
      if (!this.database.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) {
        throw new HttpError(404, 'This recipe could not be found.');
      }
      if (markCooked) {
        this.database.prepare('INSERT OR IGNORE INTO cooking_history VALUES (?, ?)').run(id, date);
      } else {
        this.database.prepare('DELETE FROM cooking_history WHERE recipe_id = ? AND date = ?').run(id, date);
      }
    });
  }

  getImage(id) {
    return this.database.prepare('SELECT mime, data FROM images WHERE id = ?').get(id);
  }

  *exportBook(recipeId = null) {
    const database = new DatabaseSync(this.filename, { readOnly: true });
    try {
      database.exec('BEGIN');
      const singleRecipe = recipeId !== null;
      const recipe = singleRecipe
        ? database.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId)
        : null;
      if (singleRecipe && !recipe) throw new HttpError(404, 'This recipe could not be found.');
      const categories = singleRecipe
        ? database.prepare('SELECT id, name, icon FROM categories WHERE id = ?').all(recipe.category_id)
        : database.prepare(selectCategories).all();
      const header = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: now(),
        categories,
        history: singleRecipe ? [] : database.prepare(selectHistory).all(),
      };
      yield `${JSON.stringify(header).slice(0, -1)},"recipes":[`;
      const images = database.prepare('SELECT id, name, mime, data FROM images WHERE recipe_id = ? ORDER BY position');
      let recipeSeparator = '';
      const recipes = singleRecipe ? [recipe] : database.prepare(selectRecipes).iterate();
      for (const row of recipes) {
        yield `${recipeSeparator}${JSON.stringify(recipeData(row)).slice(0, -1)},"images":[`;
        recipeSeparator = ',';
        let imageSeparator = '';
        for (const image of images.iterate(row.id)) {
          const data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
          const encoded = {
            id: image.id,
            name: image.name,
            dataUrl: `data:${image.mime};base64,${data.toString('base64')}`,
          };
          yield imageSeparator + JSON.stringify(encoded);
          imageSeparator = ',';
        }
        yield ']}';
      }
      yield ']}';
    } finally {
      database.close();
    }
  }

  importBook(input, mode, targetCategoryId = null) {
    const singleRecipe = mode === 'recipe';
    const backup = checkBackup(input, { includeHistory: !singleRecipe });
    if (singleRecipe && backup.recipes.length !== 1) {
      const message = backup.recipes.length
        ? 'This file contains multiple recipes. Choose “Import cookbook”.'
        : 'This file does not contain a recipe.';
      throw new HttpError(400, message);
    }
    return this.transaction(() => {
      if (singleRecipe && targetCategoryId !== null) {
        requireId(targetCategoryId, 'Category ID');
        if (!this.database.prepare('SELECT 1 FROM categories WHERE id = ?').get(targetCategoryId)) {
          throw new HttpError(400, 'The selected category no longer exists.');
        }
      }
      if (mode === 'replace') this.database.exec('DELETE FROM recipes; DELETE FROM categories;');
      const { categoryIds, importedCategories } = this.importCategories(singleRecipe ? [] : backup.categories, mode);
      const { recipeIds, importedRecipes, recipeId } = this.importRecipes(backup.recipes, categoryIds, singleRecipe, targetCategoryId);
      const addEntry = this.database.prepare('INSERT OR IGNORE INTO cooking_history VALUES (?, ?)');
      let importedHistory = 0;
      for (const value of backup.history) {
        const entry = requireObject(value, 'Cooking entry');
        if (!recipeIds.has(entry.recipeId)) {
          throw new HttpError(400, 'A cooking history entry refers to a missing recipe.');
        }
        importedHistory += addEntry.run(entry.recipeId, requireDate(entry.date)).changes;
      }
      const result = { importedCategories, importedRecipes, importedHistory, mode };
      if (singleRecipe) result.recipeId = recipeId;
      return result;
    });
  }

  importCategories(categories, mode) {
    const categoryIds = new Map();
    let importedCategories = 0;
    const findId = this.database.prepare('SELECT id FROM categories WHERE id = ?');
    const findName = this.database.prepare('SELECT id FROM categories WHERE name_key = ?');
    const addCategory = this.database.prepare(insertCategory);
    for (const value of categories) {
      const category = requireObject(value, 'Category');
      const id = requireId(category.id, 'Category ID');
      const name = checkText(category.name, 'Category name', 80, true);
      const icon = checkCategoryIcon(category.icon);
      const key = keyForName(name);
      if (categoryIds.has(id)) throw new HttpError(400, 'The file contains a duplicate category ID.');
      const existing = findId.get(id) ?? findName.get(key);
      if (existing) {
        if (mode === 'replace') throw new HttpError(400, 'The file contains duplicate category names.');
        categoryIds.set(id, existing.id);
      } else {
        addCategory.run(id, name, key, icon);
        categoryIds.set(id, id);
        importedCategories++;
      }
    }
    return { categoryIds, importedCategories };
  }

  importRecipes(recipes, categoryIds, singleRecipe, targetCategoryId) {
    const recipeIds = new Set();
    const imageIds = new Set();
    const timestamp = now();
    let importedRecipes = 0;
    let recipeId;
    const findRecipe = this.database.prepare('SELECT * FROM recipes WHERE id = ?');
    const findImage = this.database.prepare('SELECT 1 FROM images WHERE id = ?');
    const readImages = this.database.prepare('SELECT name, mime, data AS contents FROM images WHERE recipe_id = ? ORDER BY position');
    const validateImage = value => {
      const image = checkUpload(value, this.maxImageBytes);
      const id = requireId(value.id, 'Image ID');
      if (imageIds.has(id)) throw new HttpError(400, 'The file contains a duplicate image ID.');
      imageIds.add(id);
      return { ...image, id };
    };
    for (const value of recipes) {
      const recipe = checkRecipe(value);
      let id = requireId(value.id, 'Recipe ID');
      if (recipeIds.has(id)) throw new HttpError(400, 'The file contains a duplicate recipe ID.');
      recipeIds.add(id);
      if (singleRecipe) {
        recipe.categoryId = targetCategoryId;
      } else if (recipe.categoryId) {
        if (!categoryIds.has(recipe.categoryId)) {
          throw new HttpError(400, 'A recipe refers to a missing category.');
        }
        recipe.categoryId = categoryIds.get(recipe.categoryId);
      }
      const createdAt = checkTimestamp(value.createdAt, timestamp);
      const updatedAt = checkTimestamp(value.updatedAt, createdAt);
      const validatedImages = singleRecipe ? recipe.images.map(validateImage) : null;
      let existing = findRecipe.get(id);
      if (singleRecipe && existing) {
        const fingerprint = recipeFingerprint(recipe, validatedImages);
        const versionId = `import-${createHash('sha256').update(`${id}:${fingerprint}`).digest('hex')}`;
        let version = 1;
        while (existing && recipeFingerprint(recipeData(existing), readImages.iterate(id)) !== fingerprint) {
          id = version === 1 ? versionId : `${versionId}-${version}`;
          existing = findRecipe.get(id);
          version++;
        }
      }
      if (!existing) {
        insertRecipe(this.database, id, recipe, createdAt, updatedAt);
        importedRecipes++;
      }
      for (const [position, value] of (validatedImages ?? recipe.images).entries()) {
        const image = validatedImages ? value : validateImage(value);
        if (!existing) {
          insertImage(this.database, id, position, image, findImage.get(image.id) ? randomUUID() : image.id);
        }
      }
      recipeId = id;
    }
    return { recipeIds, importedRecipes, recipeId };
  }

  close() {
    this.database.close();
  }
}
