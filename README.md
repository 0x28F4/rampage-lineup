# Rampage Player

Static site for the Rampage Open Air 2026 lineup.

## Run

Serve `static/` with any static server.

## Catalog

The uv project lives in `data-collection/`.

```bash
cd data-collection
uv run python scripts/build_media_catalog.py
```

## Deploy

GitHub Pages uses `.github/workflows/pages.yml` and publishes `static/` as-is.
