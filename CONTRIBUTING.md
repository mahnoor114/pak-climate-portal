# Contributing

Thanks for your interest in improving the portal. Bug reports, data-source suggestions and pull requests are welcome.

## Getting set up

Follow the [Quick start](README.md#quick-start) to run the server. Then work on the frontend with hot reload:

```bash
cd frontend && npm ci && npm run dev   # http://localhost:5173, forwards /api and /lib to the server on :8000
```

## Before opening a pull request

- **Frontend:** `cd frontend && npm run build` must succeed.
- **Server:** `pip install -r requirements-dev.txt`, then `python -m pytest` with a built `dist/`.
- **Style:** match the surrounding code (2-space indent in JS/JSX, 4 spaces in Python). Comment the reasons behind non-obvious choices, not the obvious steps.
- **Scope:** keep each pull request to one change, and describe what you changed and how you checked it.

CI runs the same build and tests on every pull request.

## Adding a data source

New series go in `update_data.py`. Each series records its title, unit, source name and link, so the portal can credit it. Live data fetched by the server belongs in `portal_server.py`, behind the existing cache (`cached_point` for per-point data, or a background refresher for grids). Pages should never call an outside service directly.

## Never commit secrets

API keys belong in environment variables. Files such as `.env`, `*.key` and `groc api.txt` are git-ignored.
