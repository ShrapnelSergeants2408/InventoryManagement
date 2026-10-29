# FRC 2408 Inventory Management

Shop inventory, order list, order history and QR labels for FRC Team 2408, the Shrapnel Sergeants. It's an offline web app (PWA) installed on the shop tablet, with optional helper phones for counting.

- **Live app:** https://team2408.com/InventoryManagement/
- **Looking after the app:** start with [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **What it does, in detail:** [`docs/SPEC.md`](docs/SPEC.md)

```
npm ci          # install
npm run dev     # run locally
npm test        # unit tests
npm run build   # type check and production build
```

Every merge to `main` is tested, built and published to GitHub Pages (`.github/workflows/deploy.yml`).
