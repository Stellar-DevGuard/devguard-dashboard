# Stellar DevGuard Dashboard

A minimal, responsive, read-only Soroban event explorer, backed by the [DevGuard Monitor](https://github.com/Stellar-DevGuard/devguard-monitor) PostgreSQL API.

**No sample blockchain events are displayed as live data.** The dashboard queries Monitor through a same-origin server-side proxy and shows an explicit empty/error state if nothing has been indexed.

> Community-maintained. Not affiliated with or endorsed by the Stellar Development Foundation.

## Requirements

- Node.js 20 or newer
- Running DevGuard Monitor HTTP API accessible to the dashboard server
- Contract events already ingested into Monitor's PostgreSQL database

The monitor currently exposes `GET /health` and `GET /v1/events`. It is an API module, not an automatically deployed service. Follow [Monitor's API and worker guide](https://github.com/Stellar-DevGuard/devguard-monitor/blob/main/docs/api-worker.md) to host it within a trusted environment.

## Run locally

```bash
npm ci
npm run check
npm test
MONITOR_API_URL=http://127.0.0.1:4100 npm start
```

Open `http://127.0.0.1:3000`. Set `PORT` and `HOST` as necessary. The default host is **127.0.0.1** (loopback only). Do **not** deploy publicly without an authenticating gateway, TLS termination, CSRF/origin review, rate limits and access controls.

## Features

- Monitor health and connectivity feedback.
- Filter persisted Soroban contract events by Testnet/Mainnet and contract ID.
- Review ledger, event type, transaction hash, and ledger close timestamp.
- Stable pagination using Monitor's `afterLedger` and `afterEventId` tuple.
- Inspect full raw event JSON (XDR values remain encoded; no misleading decoding).
- Responsive layout, keyboard-accessible forms, and no wallet key handling.

## Architecture and scope

```
Browser (same-origin GET /api/*)
  -> devguard-dashboard Node server
     -> DevGuard Monitor GET /health, GET /v1/events
        -> PostgreSQL event rows collected by Monitor
```

The proxy forwards only the two fixed API paths. It does not accept a browser-supplied upstream URL or expose arbitrary files. The monitor's read-only API must remain private; authentication and authorization are not included in this milestone.

The dashboard does not yet provide contract subscriptions, live WebSockets, aggregate analytics across all contracts, transaction execution results, or XDR decoding. Those require separate APIs and cannot be inferred from the current stored event records.

## Contributing

Run `npm ci && npm run check && npm test` and include tests for changes to the proxy, data rendering, or pagination behavior. Open an issue for feature proposals. Please avoid submitting secrets or private endpoints.

## License

MIT.
