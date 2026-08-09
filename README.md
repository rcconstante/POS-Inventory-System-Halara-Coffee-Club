# Halara Coffee Club POS and Inventory

A responsive thesis point-of-sale, inventory, notification, and reporting
application. The frontend is plain TypeScript/JavaScript, HTML, and CSS. Supabase
provides authentication, PostgreSQL data, row-level security, transactional
operations, and image storage.

## Supabase setup

1. Open the Supabase SQL Editor for the project.
2. Run `supabase/migrations/001_initial.sql` once.
3. In **Authentication → Users**, create:
   - `r.constante.dev@gmail.com` with password `Admin@12345!`
   - `staff@halara.test` with password `Staff@12345!`
4. Return to the SQL Editor and run `supabase/setup-users.sql`.

The first SQL file creates the application tables, indexes, storage buckets,
row-level security policies, notification triggers, and transactional stock and
sales functions. The second assigns the Admin and Staff roles to the two thesis
accounts. Change the default passwords from the application after confirming
that both accounts can sign in.

## Local development

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The supplied Supabase project URL and publishable browser key are used as safe
defaults. To use another project, copy `.env.example` to `.env.local` and set:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Never place a Supabase service-role key in the frontend or in a `VITE_`
environment variable.

## Netlify deployment

The repository includes `netlify.toml`. Connect the GitHub repository in
Netlify and use the detected settings:

- Build command: `npm run build`
- Publish directory: `dist`

Every push to the production branch triggers a new deployment. Supabase keeps
the database, authentication records, and uploaded images independently of the
Netlify build.

## Validation

```sh
npm run typecheck
npm run build
```
