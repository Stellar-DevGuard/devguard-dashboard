# Contributing

This is a source-first open-source dashboard for Stellar DevGuard.

Before submitting a pull request, run:

```bash
npm ci
npm run check
npm test
```

Keep changes focused and document the real backend behavior they depend on. Add automated tests for routing, filters, and pagination. Never hardcode fabricated blockchain activity as production data. Do not commit RPC tokens, connection strings, wallet keys, or user secrets.

Report security issues privately to repository maintainers rather than including sensitive exploit details in a public GitHub issue.
