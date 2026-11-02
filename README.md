# Hiebert Home Inventory

A household inventory for two iPhones: what's in each bin and on each shelf, holiday decorations first, then the garage, attic and utility room. It's a web app (PWA) added to the home screen from Safari, with QR labels for bins and shelves. Forked from the FRC 2408 shop inventory.

- **What it does, in detail:** [`docs/SPEC.md`](docs/SPEC.md) (SPEC v2.0)
- **Looking after the app:** [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **Where it's going:** SPEC §15, milestones H0–H7

```
npm ci          # install
npm run dev     # run locally
npm test        # unit tests
npm run build   # type check and production build
```

Every merge to `main` is tested and built by `.github/workflows/deploy.yml`. Hosting moves to Cloudflare with the sync milestone (H4).
