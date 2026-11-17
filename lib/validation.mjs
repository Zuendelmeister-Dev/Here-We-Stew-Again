export const BACKUP_FORMAT = 'here-we-stew-again';
export const BACKUP_VERSION = 1;
export const MAX_IMAGES = 12;
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

const categoryIcons = new Set([
  'folder', 'soup', 'salad', 'utensils', 'drink', 'fish', 'pig', 'chicken', 'cow', 'cheese',
  'pasta', 'vegetarian', 'egg', 'christmas', 'easter', 'party', 'grill', 'dessert', 'bread', 'breakfast',
]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object.`);
  }
  return value;
}

export function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return value;
}

export function checkText(value, label, limit, required = false) {
  if (!required && value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} must be text.`);
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized && required) {
    throw new HttpError(400, `${label} is required.`);
  }
  if (normalized.length > limit) {
    throw new HttpError(400, `${label} can contain up to ${limit} characters.`);
  }
  return normalized;
}

export function checkArray(value, label, maxItems = Infinity) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a list.`);
  }
  if (value.length > maxItems) {
    throw new HttpError(400, `${label} can contain up to ${maxItems} items.`);
  }
  return value;
}

export function checkCategoryIcon(value) {
  if (value == null) return null;
  if (!categoryIcons.has(value)) throw new HttpError(400, 'The category icon is invalid.');
  return value;
}

export function checkRating(value) {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) {
    throw new HttpError(400, 'Rating must be a whole number from 1 to 5.');
  }
  return value;
}

export function checkRecipe(value) {
  const input = requireObject(value, 'Recipe');
  const difficulty = input.difficulty ?? null;
  if (difficulty !== null && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new HttpError(400, 'Difficulty must be Easy, Medium or Hard.');
  }
  const rating = checkRating(input.rating ?? null);
  const ingredients = checkArray(input.ingredients ?? [], 'Ingredients', 200)
    .map(value => checkText(value, 'Ingredient', 500))
    .filter(Boolean);
  const steps = checkArray(input.steps ?? [], 'Steps', 100)
    .map(value => {
      const step = requireObject(value, 'Step');
      const minutes = step.minutes ?? 0;
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw new HttpError(400, 'A step duration must be a whole number between 0 and 1440 minutes.');
      }
      return { text: checkText(step.text, 'Step', 4000), minutes };
    })
    .filter(step => step.text);

  return {
    title: checkText(input.title, 'Recipe title', 160, true),
    categoryId: input.categoryId == null || input.categoryId === ''
      ? null
      : requireId(input.categoryId, 'Category'),
    description: checkText(input.description, 'Description', 2000),
    ingredients,
    steps,
    notes: checkText(input.notes, 'Notes', 12000),
    difficulty,
    rating,
    images: checkArray(input.images ?? [], 'Images', MAX_IMAGES),
  };
}

export function requireDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  throw new HttpError(400, 'Enter a valid calendar date (YYYY-MM-DD).');
}

export function checkTimestamp(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) {
    const timestamp = new Date(value);
    if (Number.isFinite(timestamp.getTime())) {
      const normalized = timestamp.toISOString();
      // Date silently rolls invalid calendar days and 24:00 into the next date.
      // Keep imported timestamps within the same four-digit date as their input.
      if (normalized.slice(0, 10) === value.slice(0, 10)) return normalized;
    }
  }
  throw new HttpError(400, 'The timestamp in the import file is invalid.');
}

export function checkBackup(value, { includeHistory = true } = {}) {
  const backup = requireObject(value, 'Backup');
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new HttpError(400, 'The file is not in a supported cookbook format.');
  }
  return {
    categories: checkArray(backup.categories, 'Categories'),
    recipes: checkArray(backup.recipes, 'Recipes'),
    history: includeHistory ? checkArray(backup.history, 'Cooking history') : [],
  };
}

function detectImageType(contents) {
  if (contents.length >= 8 && contents.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (contents.length >= 4 && contents.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return 'image/jpeg';
  }
  const start = contents.toString('ascii', 0, 12);
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.startsWith('RIFF') && start.slice(8) === 'WEBP') return 'image/webp';
  if (start.slice(4, 8) === 'ftyp' && contents.length >= 16) {
    const boxLength = Math.min(contents.readUInt32BE(0), contents.length);
    if (['avif', 'avis'].includes(start.slice(8))) return 'image/avif';
    for (let offset = 16; offset + 4 <= boxLength; offset += 4) {
      if (['avif', 'avis'].includes(contents.toString('ascii', offset, offset + 4))) {
        return 'image/avif';
      }
    }
  }
  return null;
}

export function checkUpload(value, maxImageBytes) {
  const input = requireObject(value, 'Image');
  const name = checkText(input.name, 'Image name', 255) || 'Recipe photo';
  if (typeof input.dataUrl !== 'string') {
    throw new HttpError(400, 'The image data is missing.');
  }
  const comma = input.dataUrl.indexOf(',');
  const header = input.dataUrl.slice(0, comma);
  if (!/^data:image\/(?:jpeg|png|gif|webp|avif);base64$/i.test(header)) {
    throw new HttpError(400, 'Use JPEG, PNG, GIF, WebP or AVIF images.');
  }
  const base64 = input.dataUrl.slice(comma + 1);
  if (base64.length > Math.ceil(maxImageBytes / 3) * 4) {
    throw new HttpError(413, 'The image file is too large.');
  }
  // Check the alphabet without a repeating group that can exhaust the regex stack.
  const padding = base64.endsWith('==') ? 2 : Number(base64.endsWith('='));
  if (!base64.length || base64.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(base64.slice(0, base64.length - padding))) {
    throw new HttpError(400, 'The image data is invalid.');
  }
  const contents = Buffer.from(base64, 'base64');
  if (contents.length > maxImageBytes) throw new HttpError(413, 'The image file is too large.');
  const mime = detectImageType(contents);
  if (!mime || header.toLowerCase() !== `data:${mime};base64`) {
    throw new HttpError(400, 'The image contents do not match the specified format.');
  }
  return { name, mime, contents };
}
