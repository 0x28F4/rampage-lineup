# Rampage Lineup

React + shadcn/ui shell for the Rampage Open Air 2026 lineup player.

## Commands

```bash
pnpm dev
pnpm build
pnpm test
```

`pnpm build` type-checks the TypeScript app and bundles the Vite site into `dist/`.

## Catalog

The uv project lives in `data-collection/`.
It reads and updates catalog data in `public/`.

```bash
cd data-collection
uv run python scripts/build_media_catalog.py
```

## Deploy

GitHub Pages uses `.github/workflows/pages.yml`, installs with pnpm, runs `pnpm build`, and publishes `dist/`.
