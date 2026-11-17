import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createRecoveryAccount } from './lib/auth.mjs';
import { BookStore } from './lib/store.mjs';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(projectDirectory, 'data');
const filename = join(dataDirectory, 'kochbuch.sqlite');
let store;

try {
  if (!existsSync(filename)) {
    throw new Error(`No cookbook database found at ${filename}. Use the same DATA_DIR as the app.`);
  }
  const existing = new DatabaseSync(filename, { readOnly: true });
  try {
    if (existing.prepare('PRAGMA user_version').get().user_version === 0) {
      throw new Error('The database has no configured cookbook. Start the app and complete account setup first.');
    }
  } finally {
    existing.close();
  }

  store = new BookStore(dataDirectory, join(projectDirectory, 'public', 'images'), 8 * 1024 ** 2);
  const { username, password } = await createRecoveryAccount(store.database);
  console.log('Temporary recovery account created.');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  console.log('Sign in with these credentials in the app, then set your regular username and password.');
  console.log('A successful reset or another recovery:create command invalidates this recovery account.');
} catch (error) {
  console.error(`Could not create a recovery account. ${error.message}`);
  process.exitCode = 1;
} finally {
  store?.close();
}
