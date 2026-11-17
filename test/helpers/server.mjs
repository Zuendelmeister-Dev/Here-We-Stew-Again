import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export async function temporaryData(t) {
  const directory = await mkdtemp(join(tmpdir(), 'here-we-stew-test-'));
  const stops = [];
  t.after(async () => {
    try {
      await Promise.all(stops.map((stop) => stop()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return { directory, stops };
}

export async function startServer(data, secureCookies = '0', settings = {}) {
  // stdin EOF invokes the real shutdown handler on Windows and Unix. Killing
  // the process on Windows would skip SQLite cleanup and V8 coverage output.
  const bootstrap = `
    await import('./server.mjs');
    process.stdin.resume();
    process.stdin.once('end', () => process.emit('SIGTERM'));
  `;
  const server = spawn(process.execPath, ['--input-type=module', '--eval', bootstrap], {
    cwd: root,
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data.directory,
      SECURE_COOKIES: secureCookies, MAX_IMPORT_BYTES: '', MAX_IMAGE_BYTES: '',
      ...settings,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  server.stdin.on('error', () => { /* Startup failures are reported through exited. */ });
  const exited = once(server, 'close');
  let stopping;
  const stop = () => stopping ??= (async () => {
    if (server.exitCode !== null || server.signalCode !== null) {
      const [code, signal] = await exited;
      assert.equal(signal, null, `Server terminated unexpectedly. ${stderr}`);
      assert.equal(code, 0, `Server exited with code ${code}. ${stderr}`);
      return;
    }
    const fallback = setTimeout(() => server.kill('SIGKILL'), 5000);
    fallback.unref();
    server.stdin.end();
    try {
      const [code, signal] = await exited;
      assert.equal(signal, null, `Server required forced shutdown. ${stderr}`);
      assert.equal(code, 0, `Server exited with code ${code}. ${stderr}`);
    } finally {
      clearTimeout(fallback);
    }
  })();
  data.stops.push(stop);
  const stdout = createInterface({ input: server.stdout });
  try {
    const [line] = await Promise.race([
      once(stdout, 'line', { signal: AbortSignal.timeout(5000) }),
      exited.then(([code]) => { throw new Error(`Server exited with code ${code}. ${stderr}`); }),
    ]);
    const origin = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(origin, line);
    const request = async (path, status, { method = 'GET', body, cookie, headers = {}, rawBody } = {}) => {
      const response = await fetch(origin + path, {
        method,
        headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        ...(rawBody != null && { duplex: 'half' }),
        signal: AbortSignal.timeout(5000),
      });
      if (status !== undefined) assert.equal(response.status, status, `${method} ${path}`);
      return response;
    };
    const post = (path, status, body, cookie) => request(path, status, { method: 'POST', body, cookie });
    return { request, post, stop };
  } finally {
    stdout.close();
  }
}

export function session(response) {
  return response.headers.get('set-cookie').split(';', 1)[0];
}
