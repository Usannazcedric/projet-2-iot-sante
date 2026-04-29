# EHPAD Frontend (Sub-project 6)

React + Vite + TypeScript + Tailwind dashboard.

## Routes

- `/` — grid of all residents
- `/resident/:id` — drill-down (history + alerts)
- `/alerts` — alert log

## Dev

```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
```

The dev server proxies `/api`, `/sim`, and `/ws` to the corresponding services on localhost.

## Production (Docker)

The compose stack builds the frontend with Vite and serves it from nginx, which also reverse-proxies `/api`, `/sim`, and `/ws`.
