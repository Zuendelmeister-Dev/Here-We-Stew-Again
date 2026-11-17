import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Auth } from './lib/auth.mjs';
import { BookStore } from './lib/store.mjs';
import { HttpError, MAX_IMAGES, requireObject } from './lib/validation.mjs';

const MiB = 1024 * 1024;
const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const publicDirectory = resolve(projectDirectory, 'public');
const host = process.env.HOST || '127.0.0.1';
const port = configNumber('PORT', 3000, 0, 65535);
const maxImageBytes = configNumber('MAX_IMAGE_BYTES', 8 * MiB, 1, 24 * MiB);
const maxRecipeBytes = Math.ceil(maxImageBytes / 3) * 4 * MAX_IMAGES + 2 * MiB;
const maxImportBytes = configNumber('MAX_IMPORT_BYTES', 256 * MiB, 1, 500 * MiB);
const dataDirectory = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(projectDirectory, 'data');
const store = new BookStore(dataDirectory, join(publicDirectory, 'images'), maxImageBytes);
const auth = new Auth(store.database, process.env.SECURE_COOKIES === '1');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const contentPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

function configNumber(name, fallback, minimum, maximum) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function noContent(response) {
  response.writeHead(204);
  response.end();
}

async function sendExport(response, filename, chunks) {
  try {
    const firstChunk = chunks.next().value;
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    await pipeline(Readable.from((function* () {
      yield firstChunk;
      yield* chunks;
    })()), response);
  } finally {
    chunks.return();
  }
}

function methodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed.join(', '));
  throw new HttpError(405, 'This method is not supported.');
}

function readJson(request, maxBytes) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'The request must contain JSON (application/json).');
  }
  if (Number(request.headers['content-length']) > maxBytes) {
    throw new HttpError(413, 'The request is too large.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const receive = chunk => {
      length += chunk.length;
      if (length > maxBytes) {
        request.removeListener('data', receive);
        chunks.length = 0;
        reject(new HttpError(413, 'The request is too large.'));
        return;
      }
      chunks.push(chunk);
    };
    request.on('data', receive);
    request.once('error', reject);
    request.once('end', () => {
      if (length > maxBytes) return;
      try {
        const body = Buffer.concat(chunks, length).toString('utf8').replace(/^\uFEFF/, '');
        request.removeListener('data', receive);
        chunks.length = 0;
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'The request does not contain valid JSON.'));
      }
    });
  });
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed(response, ['GET', 'HEAD']);
  }
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'The URL is invalid.');
  }
  if (path === '/') path = '/index.html';
  const file = resolve(publicDirectory, `.${path}`);
  const mime = mimeTypes.get(extname(file).toLowerCase());
  if (!file.startsWith(publicDirectory + sep) || /[\\:\u0000]/.test(path) || !mime) {
    throw new HttpError(404, 'This page could not be found.');
  }
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
      throw new HttpError(404, 'This page could not be found.');
    }
    throw error;
  }
  response.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-cache',
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

async function serveApi(request, response, url) {
  response.setHeader('Cache-Control', 'no-store');
  const { pathname, searchParams } = url;
  const { method } = request;

  if (pathname === '/api/health') {
    if (method !== 'GET') return methodNotAllowed(response, ['GET']);
    return sendJson(response, 200, { status: 'ok' });
  }
  if (pathname === '/api/auth/login' || pathname === '/api/auth/setup' || pathname === '/api/auth/logout') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST']);
    const body = await readJson(request, 8 * 1024);
    if (pathname === '/api/auth/logout') {
      auth.logout(request, response);
      return noContent(response);
    }
    const result = pathname === '/api/auth/login'
      ? await auth.login(request, response, body)
      : await auth.setup(request, response, body);
    return sendJson(response, 200, result);
  }
  auth.requireAccess(request);
  if (pathname === '/api/book') {
    if (method !== 'GET') return methodNotAllowed(response, ['GET']);
    const limits = { maxImageBytes, maxImages: MAX_IMAGES, maxImportBytes };
    return sendJson(response, 200, { ...store.getBook(), limits });
  }
  if (pathname === '/api/export') {
    if (method !== 'GET') return methodNotAllowed(response, ['GET']);
    const date = new Date().toISOString().slice(0, 10);
    return sendExport(response, `cookbook-${date}.json`, store.exportBook());
  }
  if (pathname === '/api/import') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST']);
    const mode = searchParams.get('mode') ?? 'merge';
    if (!['merge', 'replace', 'recipe'].includes(mode)) {
      throw new HttpError(400, 'This import mode is not supported.');
    }
    return sendJson(response, 200, store.importBook(
      await readJson(request, maxImportBytes), mode, searchParams.get('categoryId') || null,
    ));
  }

  if (pathname === '/api/categories') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST']);
    return sendJson(response, 201, store.saveCategory(await readJson(request, 16 * 1024)));
  }
  const category = /^\/api\/categories\/([a-zA-Z0-9_-]{1,120})$/.exec(pathname);
  if (category) {
    const id = category[1];
    if (method === 'PUT') {
      return sendJson(response, 200, store.saveCategory(await readJson(request, 16 * 1024), id));
    }
    if (method === 'DELETE') {
      store.deleteCategory(id);
      return noContent(response);
    }
    return methodNotAllowed(response, ['PUT', 'DELETE']);
  }

  if (pathname === '/api/recipes') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST']);
    return sendJson(response, 201, { id: store.saveRecipe(await readJson(request, maxRecipeBytes)) });
  }
  const recipe = /^\/api\/recipes\/([a-zA-Z0-9_-]{1,120})(?:\/(cooked|export|rating))?$/.exec(pathname);
  if (recipe) {
    const [, id, action] = recipe;
    if (action === 'export') {
      if (method !== 'GET') return methodNotAllowed(response, ['GET']);
      return sendExport(response, `recipe-${id}.json`, store.exportBook(id));
    }
    if (action === 'cooked') {
      if (method !== 'POST' && method !== 'DELETE') {
        return methodNotAllowed(response, ['POST', 'DELETE']);
      }
      const date = method === 'DELETE' && searchParams.has('date')
        ? searchParams.get('date')
        : requireObject(await readJson(request, 16 * 1024), 'Cooking entry').date;
      store.setCooked(id, date, method === 'POST');
      return noContent(response);
    }
    if (action === 'rating') {
      if (method !== 'PATCH') return methodNotAllowed(response, ['PATCH']);
      const input = requireObject(await readJson(request, 16 * 1024), 'Recipe rating');
      return sendJson(response, 200, { rating: store.setRecipeRating(id, input.rating) });
    }
    if (method === 'PUT') {
      return sendJson(response, 200, { id: store.saveRecipe(await readJson(request, maxRecipeBytes), id) });
    }
    if (method === 'DELETE') {
      store.deleteRecipe(id);
      return noContent(response);
    }
    return methodNotAllowed(response, ['PUT', 'DELETE']);
  }

  const image = /^\/api\/images\/([a-zA-Z0-9_-]{1,120})$/.exec(pathname);
  if (image) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(response, ['GET', 'HEAD']);
    const data = store.getImage(image[1]);
    if (!data) throw new HttpError(404, 'This image could not be found.');
    response.writeHead(200, {
      'Content-Type': data.mime,
      'Content-Length': data.data.byteLength,
      'Cache-Control': 'private, no-cache',
    });
    response.end(method === 'HEAD' ? undefined : data.data);
    return;
  }
  throw new HttpError(404, 'This URL could not be found.');
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', contentPolicy);
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await serveApi(request, response, url);
    } else {
      await serveStatic(request, response, url.pathname);
    }
  } catch (error) {
    if (response.destroyed || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (!request.complete) {
      response.setHeader('Connection', 'close');
      request.resume();
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, {
        error: error.message,
        ...(error.recoveryRequired && { recoveryRequired: true }),
      });
      return;
    }
    console.error(error);
    sendJson(response, 500, { error: 'The cookbook could not process the request.' });
  }
});

server.listen(port, host, () => {
  const urlHost = host === '0.0.0.0' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  console.log(`Here We Stew Again is running at http://${urlHost}:${server.address().port}`);
});

function shutdown() {
  server.close(() => store.close());
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
