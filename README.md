# Halara Coffee Club POS and Inventory

A responsive local full-stack point-of-sale, inventory, and reporting system.
The browser interface uses a Node.js API, SQLite database, HTTP-only account
sessions, and server-managed product image uploads.

## Requirements

- Node.js 24 or newer
- npm 11 or newer

## Start locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. One development server now hosts both the UI and
the API, so they cannot accidentally be started separately.

Default thesis accounts:

- Contributor / Admin: `r.constante.dev@gmail.com` / `Admin@12345!`
- Staff: `staff@halara.test` / `Staff@12345!`

The default passwords stop working after they are changed in Settings.

## Persistent files

- SQLite database: `data/halara.sqlite`
- Product photos: `data/uploads/products/`
- SQL migration: `server/sql/001_initial.sql`

Building or restarting the application does not remove these files. To
explicitly create a fresh database containing only the two thesis accounts:

```sh
npm run db:reset
```

## Production-style local run

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4174`.

## Validation

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```
