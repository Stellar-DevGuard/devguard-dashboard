import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8']
});
const MAX_BODY = 2_000_000;

export function parseMonitorUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('MONITOR_API_URL must be an HTTP(S) origin without credentials, path or query');
  }
  return url.origin;
}

function authorized(header, user, password) {
  if (user === undefined && password === undefined) return true;
  if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(header)) return false;
  const token = header.slice(6);
  const supplied = Buffer.from(token, 'base64');
  if (supplied.toString('base64') !== token) return false;
  const expected = createHash('sha256').update(user + ':' + password).digest();
  const actual = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expected, actual);
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

/** A fixed-path reverse proxy: never accept a caller-supplied upstream address. */
export function createDashboardServer({
  monitorUrl = 'http://127.0.0.1:4100',
  fetchImpl = globalThis.fetch,
  assetLoader = readFile,
  logger = console,
  authUser,
  authPassword
} = {}) {
  const origin = parseMonitorUrl(monitorUrl);
  if ((authUser === undefined) !== (authPassword === undefined) ||
      (authUser !== undefined && (typeof authUser !== 'string' || !authUser ||
        typeof authPassword !== 'string' || authPassword.length < 12 || authUser.includes(':')))) {
    throw new TypeError('Provide both authUser and authPassword (at least 12 characters), or neither');
  }
  return createServer(async (req, res) => {
    if (!authorized(req.headers.authorization, authUser, authPassword)) {
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="DevGuard Dashboard", charset="UTF-8"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      return res.end('Authentication required');
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return json(res, 400, { error: 'Malformed URL' }); }
    if (url.pathname === '/api/health' || url.pathname === '/api/events') {
      if (req.url.length > 3000) return json(res, 414, { error: 'Request URL too long' });
      const destination = new URL(url.pathname === '/api/health' ? '/health' : '/v1/events', origin);
      if (url.pathname === '/api/health' && url.search) return json(res, 400, { error: 'Health query not supported' });
      if (url.pathname === '/api/events') destination.search = url.search;
      try {
        const upstream = await fetchImpl(destination.toString(), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        const body = await upstream.text();
        if (body.length > MAX_BODY) return json(res, 502, { error: 'Monitor response too large' });
        let parsed;
        try { parsed = JSON.parse(body); }
        catch { return json(res, 502, { error: 'Monitor returned invalid JSON' }); }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return json(res, 502, { error: 'Monitor returned unexpected data' });
        }
        return json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 200, parsed);
      } catch (error) {
        logger.error?.('Monitor request failed', { message: error.message });
        return json(res, 502, { error: 'Unable to reach DevGuard Monitor' });
      }
    }
    const asset = ASSETS[url.pathname];
    if (!asset || url.search) return json(res, 404, { error: 'Not found' });
    try {
      const data = await assetLoader(resolve(ROOT, asset[0]));
      res.writeHead(200, {
        'content-type': asset[1],
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer'
      });
      res.end(data);
    } catch (error) {
      logger.error?.('Static asset unavailable', { message: error.message });
      json(res, 500, { error: 'Dashboard asset unavailable' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const authUser = process.env.DASHBOARD_AUTH_USER;
  const authPassword = process.env.DASHBOARD_AUTH_PASSWORD;
  if (host !== '127.0.0.1' && host !== '::1' &&
      !(process.env.ALLOW_EXTERNAL_BINDING === 'true' && authUser && authPassword)) {
    throw new Error('Non-loopback hosting requires ALLOW_EXTERNAL_BINDING=true and dashboard authentication');
  }
  const app = createDashboardServer({
    monitorUrl: process.env.MONITOR_API_URL || 'http://127.0.0.1:4100',
    authUser, authPassword
  });
  app.listen(port, host, () => console.log(`DevGuard Dashboard listening on http://${host}:${port}`));
}
