import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { validateConfig, createRpc } from '../monitor/src/ingester.js';
import { migrate } from '../monitor/src/postgres.js';
import { startService } from '../monitor/src/service.js';
import { createDashboardServer } from '../src/server.js';

const contractId = 'C' + 'B'.repeat(55);
const env = process.env.TEST_DATABASE_URL;
if (!env) throw new Error('TEST_DATABASE_URL required for integration tests');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('ingested RPC event flows through PostgreSQL, Monitor API and Dashboard proxy', async () => {
  const pool = new pg.Pool({ connectionString: env, max: 3 });
  const event = {
    id: '0000000000000000500-0000000001',
    contractId, ledger: 500, type: 'contract',
    txHash: 'a'.repeat(64), ledgerClosedAt: '2026-10-22T00:00:00Z',
    topic: ['AAAA'], value: 'AAAA'
  };
  const rpcServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let result;
    if (request.method === 'getNetwork') result = { passphrase: 'Test SDF Network ; September 2015' };
    else if (request.method === 'getHealth') result = { status: 'healthy', oldestLedger: 400, latestLedger: 520 };
    else if (request.method === 'getEvents') result = { events: [event], cursor: 'cursor500', latestLedger: 520 };
    else result = {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  let monitor = null, dashboard = null;
  try {
    await migrate(pool);
    await pool.query('DELETE FROM devguard_events WHERE network=$1 AND contract_id=$2', ['testnet', contractId]);
    await pool.query('DELETE FROM devguard_checkpoints WHERE network=$1 AND contract_id=$2', ['testnet', contractId]);
    const rpcUrl = await listen(rpcServer);
    const config = validateConfig({ rpcUrl, contractId, startLedger: 500, network: 'testnet', limit: 20 });
    monitor = await startService({
      pool, settings: { config, port: 0, host: '127.0.0.1', intervalMs: 100, migrateOnStart: false },
      rpc: createRpc(rpcUrl),
      logger: { info() {}, error(error, details) { throw new Error(error + ': ' + JSON.stringify(details)); } }
    });
    const monitorUrl = `http://127.0.0.1:${monitor.server.address().port}`;
    dashboard = createDashboardServer({ monitorUrl });
    const dashboardUrl = await listen(dashboard);

    let events = [];
    const endpoint = dashboardUrl + '/api/events?network=testnet&contractId=' + contractId + '&limit=25';
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await fetch(endpoint);
      assert.equal(response.status, 200);
      const body = await response.json();
      events = body.events;
      if (events.some(item => item.id === event.id)) break;
      await delay(100);
    }
    assert.deepEqual(events.map(item => item.id), [event.id]);
    const health = await fetch(dashboardUrl + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    assert.equal((await fetch(dashboardUrl + '/')).status, 200);
    const rows = await pool.query('SELECT count(*)::integer AS total FROM devguard_events WHERE network=$1 AND contract_id=$2',
      ['testnet', contractId]);
    assert.equal(rows.rows[0].total, 1, 'polling does not duplicate events');
  } finally {
    if (dashboard) await new Promise(resolve => dashboard.close(resolve));
    if (monitor) await monitor.close();
    // Cleanup is isolated to the test contract and closes the pool.
    const cleanupPool = new pg.Pool({ connectionString: env });
    try {
      await cleanupPool.query('DELETE FROM devguard_events WHERE network=$1 AND contract_id=$2', ['testnet', contractId]);
      await cleanupPool.query('DELETE FROM devguard_checkpoints WHERE network=$1 AND contract_id=$2', ['testnet', contractId]);
    } finally { await cleanupPool.end(); }
    if (!monitor) await pool.end();
    await new Promise(resolve => rpcServer.close(resolve));
  }
});
