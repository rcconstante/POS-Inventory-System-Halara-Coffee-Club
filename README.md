# Halara Coffee Club POS and Inventory

A responsive thesis point-of-sale, inventory, notification, and reporting
application. The frontend is plain TypeScript/JavaScript, HTML, and CSS. Supabase
provides authentication, PostgreSQL data, row-level security, transactional
operations, and image storage.

## Supabase setup

1. Open the Supabase SQL Editor for the project.
2. Run the SQL files in `supabase/migrations` in numeric order. Existing
   installations that already ran `001_initial.sql` only need to run
   `002_product_recipes.sql`.
3. In **Authentication → Users**, create:
   - `r.constante.dev@gmail.com` with password `Admin@12345!`
   - `staff@halara.test` with password `Staff@12345!`
4. Return to the SQL Editor and run `supabase/setup-users.sql`.

The first SQL file creates the application tables, indexes, storage buckets,
row-level security policies, notification triggers, and transactional stock and
sales functions. Migration `002_product_recipes.sql` separates raw materials
from finished POS items, adds per-serving recipes, and deducts all recipe
ingredients atomically when a sale is completed. `setup-users.sql` assigns the
Admin and Staff roles to the two thesis accounts. Change the default passwords
from the application after confirming that both accounts can sign in.

After applying migration 002, review the Admin **Products** workspace. Existing
priced products are classified as finished products and must be given a recipe
before staff can sell them. Existing zero-price products are classified as raw
materials. Stock raw materials in their recipe unit (for example, `mL`, `g`, or
`pcs`) so recipe quantities and on-hand quantities use the same measurement.

Migration `003_default_menu.sql` adds the client-provided food, pastry, drink,
and add-on menu with the listed prices. It intentionally does not add stock
photos or guessed recipes. Administrators upload the real product photos and
configure each item's actual recipe from **Products → Finished products** before
the item becomes available for sale. Migration `004_allow_draft_finished_products.sql`
allows those photos and menu details to be saved while the recipe is still being
prepared; draft items remain disabled in POS.

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
