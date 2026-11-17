import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { checkText, HttpError, requireObject } from './validation.mjs';

const deriveKey = promisify(scrypt);
const cookieName = 'stew_session';
const sessionSeconds = 12 * 60 * 60;
const setupSeconds = 15 * 60;
const loginWindow = 60_000;

function passwordHash(password, salt) {
  return deriveKey(password, salt, 64, { N: 32_768, maxmem: 64 * 1024 * 1024 });
}

function credentials(value) {
  const input = requireObject(value, 'Credentials');
  const username = checkText(input.username, 'Username', 80, true);
  const password = input.password;
  if (typeof password !== 'string' || !password.trim() || password.length > 256) {
    throw new HttpError(400, 'Enter a password of up to 256 characters.');
  }
  return { username, password };
}

function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|;\s*)stew_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function pruneExpired(entries, now) {
  for (const [key, { expires }] of entries) {
    if (expires <= now) entries.delete(key);
  }
}

export async function createRecoveryAccount(database) {
  const account = database.prepare('SELECT username FROM account WHERE id = 1').get();
  if (!account) throw new Error('Set up the main account before creating a recovery user.');
  const username = `recovery-${randomBytes(12).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16);
  const hash = await passwordHash(password, salt);
  const generation = randomBytes(32).toString('hex');
  database.prepare(`
    INSERT INTO recovery_account (id, username, salt, password_hash, generation)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username, salt = excluded.salt,
      password_hash = excluded.password_hash, generation = excluded.generation
  `).run(username, salt, hash, generation);
  return { username, password };
}

export class Auth {
  #account;
  #database;
  #sessions = new Map();
  #attempts = new Map();
  #checksInProgress = 0;
  #saveAccount;
  #readRecovery;
  #secureCookies;

  constructor(database, secureCookies) {
    this.#database = database;
    this.#account = database.prepare('SELECT username, salt, password_hash AS hash FROM account WHERE id = 1').get();
    this.#saveAccount = database.prepare(`
      INSERT INTO account (id, username, salt, password_hash) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, salt = excluded.salt,
        password_hash = excluded.password_hash
    `);
    this.#readRecovery = database.prepare('SELECT username, salt, password_hash AS hash, generation FROM recovery_account WHERE id = 1');
    this.#secureCookies = secureCookies;
  }

  getSession(request) {
    const token = sessionToken(request);
    const session = this.#sessions.get(token);
    if (session && session.expires > Date.now()
      && (!session.recoveryGeneration || this.#readRecovery.get()?.generation === session.recoveryGeneration)) {
      return session;
    }
    this.#sessions.delete(token);
    return null;
  }

  requireAccess(request) {
    const session = this.getSession(request);
    if (!session) throw new HttpError(401, 'Sign in to open the cookbook.');
    if (session.setupRequired) {
      const error = new HttpError(403, 'Save your credentials first.');
      if (session.recoveryGeneration) error.recoveryRequired = true;
      throw error;
    }
  }

  async login(request, response, value) {
    const { username, password } = credentials(value);
    const now = Date.now();
    pruneExpired(this.#attempts, now);
    const address = request.socket.remoteAddress;
    const attempts = this.#attempts.get(address) ?? { count: 0, expires: now + loginWindow };
    if (attempts.count >= 10 || this.#checksInProgress >= 4) {
      throw new HttpError(429, 'Too many sign-in attempts. Try again in a moment.');
    }
    attempts.count++;
    this.#attempts.set(address, attempts);
    const account = this.#account;
    const recovery = this.#readRecovery.get();
    const recoveryLogin = recovery?.username === username;
    const candidate = recoveryLogin ? recovery : account;
    this.#checksInProgress++;
    let valid;
    try {
      if (candidate) {
        const hash = await passwordHash(password, candidate.salt);
        valid = timingSafeEqual(hash, candidate.hash) && username === candidate.username;
      } else {
        valid = username === 'steward' && password === 'cooksagain';
      }
    } finally {
      this.#checksInProgress--;
    }
    if (!valid || account !== this.#account
      || (recoveryLogin && this.#readRecovery.get()?.generation !== recovery.generation)) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    this.#attempts.delete(address);
    return this.#startSession(request, response, recoveryLogin ? recovery.generation : null);
  }

  async setup(request, response, value) {
    const session = this.getSession(request);
    if (!session) throw new HttpError(401, 'Sign in again to set up your credentials.');
    if (!session.setupRequired || (this.#account && !session.recoveryGeneration)) {
      throw new HttpError(409, 'The credentials have already been set up.');
    }
    const { username, password } = credentials(value);
    if (this.#checksInProgress >= 4) {
      throw new HttpError(429, 'The server is busy. Try again in a moment.');
    }
    const salt = randomBytes(16);
    this.#checksInProgress++;
    let hash;
    try {
      hash = await passwordHash(password, salt);
    } finally {
      this.#checksInProgress--;
    }
    if (this.getSession(request) !== session) throw new HttpError(401, 'Sign in again.');
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      if (session.recoveryGeneration) {
        const consumed = this.#database.prepare('DELETE FROM recovery_account WHERE id = 1 AND generation = ?')
          .run(session.recoveryGeneration);
        if (!consumed.changes) throw new HttpError(401, 'Sign in again.');
      }
      this.#saveAccount.run(username, salt, hash);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    this.#account = { username, salt, hash };
    this.#sessions.clear();
    return this.#startSession(request, response);
  }

  logout(request, response) {
    this.#sessions.delete(sessionToken(request));
    this.#setCookie(response, '', 0);
  }

  #startSession(request, response, recoveryGeneration = null) {
    const now = Date.now();
    pruneExpired(this.#sessions, now);
    this.#sessions.delete(sessionToken(request));
    const setupRequired = !this.#account || recoveryGeneration !== null;
    const maxAge = setupRequired ? setupSeconds : sessionSeconds;
    const token = randomBytes(32).toString('hex');
    this.#sessions.set(token, { expires: now + maxAge * 1000, setupRequired, recoveryGeneration });
    this.#setCookie(response, token, maxAge);
    return recoveryGeneration ? { setupRequired, recoveryRequired: true } : { setupRequired };
  }

  #setCookie(response, token, maxAge) {
    const secure = this.#secureCookies ? '; Secure' : '';
    response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/api/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`);
  }
}
