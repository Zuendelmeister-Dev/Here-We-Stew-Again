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

export class Auth {
  #account;
  #sessions = new Map();
  #attempts = new Map();
  #checksInProgress = 0;
  #insertAccount;
  #secureCookies;

  constructor(database, secureCookies) {
    this.#account = database.prepare('SELECT username, salt, password_hash AS hash FROM account WHERE id = 1').get();
    this.#insertAccount = database.prepare('INSERT INTO account (id, username, salt, password_hash) VALUES (1, ?, ?, ?)');
    this.#secureCookies = secureCookies;
  }

  getSession(request) {
    const token = sessionToken(request);
    const session = this.#sessions.get(token);
    if (session && session.expires > Date.now()) return session;
    this.#sessions.delete(token);
    return null;
  }

  requireAccess(request) {
    const session = this.getSession(request);
    if (!session) throw new HttpError(401, 'Sign in to open the cookbook.');
    if (session.setupRequired) throw new HttpError(403, 'Save your credentials first.');
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
    this.#checksInProgress++;
    let valid;
    try {
      if (account) {
        const hash = await passwordHash(password, account.salt);
        valid = timingSafeEqual(hash, account.hash) && username === account.username;
      } else {
        valid = username === 'steward' && password === 'cooksagain';
      }
    } finally {
      this.#checksInProgress--;
    }
    if (!valid || account !== this.#account) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    this.#attempts.delete(address);
    return this.#startSession(request, response);
  }

  async setup(request, response, value) {
    const session = this.getSession(request);
    if (!session) throw new HttpError(401, 'Sign in again to set up your credentials.');
    if (!session.setupRequired || this.#account) {
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
    this.#insertAccount.run(username, salt, hash);
    this.#account = { username, salt, hash };
    this.#sessions.clear();
    return this.#startSession(request, response);
  }

  logout(request, response) {
    this.#sessions.delete(sessionToken(request));
    this.#setCookie(response, '', 0);
  }

  #startSession(request, response) {
    const now = Date.now();
    pruneExpired(this.#sessions, now);
    this.#sessions.delete(sessionToken(request));
    const setupRequired = !this.#account;
    const maxAge = setupRequired ? setupSeconds : sessionSeconds;
    const token = randomBytes(32).toString('hex');
    this.#sessions.set(token, { expires: now + maxAge * 1000, setupRequired });
    this.#setCookie(response, token, maxAge);
    return { setupRequired };
  }

  #setCookie(response, token, maxAge) {
    const secure = this.#secureCookies ? '; Secure' : '';
    response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/api/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`);
  }
}
