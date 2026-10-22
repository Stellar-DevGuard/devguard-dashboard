# Local stack (experimental)

This Compose setup starts PostgreSQL, the Soroban event Monitor and the Dashboard. The Core CLI remains a separate standalone package. There is no fabricated chain data.

## Setup

Check out both repositories in sibling directories named devguard-monitor and devguard-dashboard. Install Docker Engine and Compose v2.

From devguard-dashboard:

1. Copy .env.compose.example to .env.
2. Replace DB_PASSWORD with a strong URL-safe database password, and DASHBOARD_AUTH_PASSWORD with a strong random password.
3. Set CONTRACT_ID to a real deployed Stellar contract. Set START_LEDGER to a recently retained ledger available from your RPC getHealth response; the example value is not valid indefinitely.
4. Run the commands below.

```bash
docker compose config --quiet
docker compose up --build -d
docker compose logs -f monitor
```

Open http://127.0.0.1:3000 and sign in using DASHBOARD_AUTH_USER and DASHBOARD_AUTH_PASSWORD.

## Network model

The database has no published host port. Monitor binds API to loopback within its container network namespace. Dashboard joins that namespace, reaches Monitor at 127.0.0.1:4100 and publishes port 3000 to the host loopback only. Browser access is protected by Basic authentication.

Do not expose the dashboard to the public internet over HTTP. Use an authenticating HTTPS reverse proxy if remote access is required.

## Operations

- Indexed events and checkpoints persist in the postgres_data named Docker volume. docker compose down preserves the volume; docker compose down -v destroys all stored history.
- This setup runs one contract ingester. Additional contract indexing needs separate service configuration.
- Ensure START_LEDGER falls inside the provider's getEvents retention window. Old historical events are unavailable from ordinary RPC endpoints.
- MIGRATE_ON_START=true is for local setup; production deployments need versioned migrations and restricted database roles.
- The Monitor image installs pg@8 during Docker build because the driver is not yet represented in the runtime package lock. This is not a fully reproducible production container.
- The interface currently supports contract event history, not alerts, balance views, or transaction execution results.

See https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents for the current Stellar RPC semantics.
