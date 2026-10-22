import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer, parseMonitorUrl } from '../src/server.js';

async function withServer(server, fn) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const jsonResponse = (data, status = 200) => ({
  status, text: async () => JSON.stringify(data)
});

test('GET / serves dashboard with restrictive CSP and no remote scripts', async () => {
  await withServer(createDashboardServer({ fetchImpl: async () => jsonResponse({}) }), async base => {
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    const body = await response.text();
    assert.match(body, /Contract event explorer/);
  });
});
test('server only serves allowlisted assets', async () => {
  await withServer(createDashboardServer(), async base => {
    assert.equal((await fetch(base + '/app.js')).status, 200);
    assert.equal((await fetch(base + '/styles.css')).status, 200);
    assert.equal((await fetch(base + '/src/server.js')).status, 404);
    assert.equal((await fetch(base + '/package.json')).status, 404);
  });
});
test('health proxy requests fixed monitor endpoint', async () => {
  const calls = [];
  const server = createDashboardServer({
    monitorUrl: 'http://127.0.0.1:4100',
    fetchImpl: async url => { calls.push(url); return jsonResponse({ status: 'ok' }); }
  });
  await withServer(server, async base => {
    const result = await fetch(base + '/api/health');
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { status: 'ok' });
    assert.deepEqual(calls, ['http://127.0.0.1:4100/health']);
  });
});
test('event query preserves contract filters and composite cursor', async () => {
  const calls = [];
  const server = createDashboardServer({
    fetchImpl: async url => { calls.push(url); return jsonResponse({ events: [{ id: 'one' }], nextCursor: null }); }
  });
  await withServer(server, async base => {
    const query = '?network=testnet&contractId=C' + 'A'.repeat(55) + '&afterLedger=100&afterEventId=a&limit=25';
    const result = await fetch(base + '/api/events' + query);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).events[0].id, 'one');
    const forwarded = new URL(calls[0]);
    assert.equal(forwarded.pathname, '/v1/events');
    assert.equal(forwarded.searchParams.get('afterEventId'), 'a');
  });
});
test('upstream client errors are returned without converting them to successes', async () => {
  const server = createDashboardServer({ fetchImpl: async () => jsonResponse({ error: 'Invalid pagination' }, 400) });
  await withServer(server, async base => {
    const result = await fetch(base + '/api/events');
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { error: 'Invalid pagination' });
  });
});
test('monitor failures return sanitized 502', async () => {
  const server = createDashboardServer({ fetchImpl: async () => { throw Error('private upstream secret'); }, logger: { error() {} } });
  await withServer(server, async base => {
    const response = await fetch(base + '/api/events');
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret/);
  });
});
test('rejects invalid upstream URLs including embedded credentials', () => {
  assert.throws(() => parseMonitorUrl('file:///tmp/secret'), /HTTP/);
  assert.throws(() => parseMonitorUrl('https://user:password@example.com/'), /credentials/);
  assert.throws(() => parseMonitorUrl('https://example.com/path'), /path/);
});
test('rejects disallowed methods, static path queries and proxy health queries', async () => {
  const server = createDashboardServer();
  await withServer(server, async base => {
    assert.equal((await fetch(base + '/api/events', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/?foo=1')).status, 404);
    assert.equal((await fetch(base + '/api/health?foo=1')).status, 400);
  });
});
