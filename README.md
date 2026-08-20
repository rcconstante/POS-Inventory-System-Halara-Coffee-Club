# Halara Coffee Club POS and Inventory

A responsive thesis point-of-sale, inventory, notification, and reporting
application. The frontend is plain TypeScript/JavaScript, HTML, and CSS. Supabase
provides authentication, PostgreSQL data, row-level security, transactional
operations, and image storage.

## Supabase setup

1. Open the Supabase SQL Editor for the project.
2. Run the SQL files in `supabase/migrations` in numeric order. Existing
   installations should apply every newer numbered migration they have not yet
   run, through `005_inventory_tracking_scope.sql`.
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
prepared. Migration `005_inventory_tracking_scope.sql` enforces the approved
scope: coffee, sandwiches, and per-piece pastries require recipes; Pasta, Not
Coffee, Tea Refreshers and Soda, and Add-ons can be sold without inventory
deductions. The tracking decision is snapshotted on every sale item so cancelling
or restoring an order remains safe even if the catalog changes later.

### Test-only ingredients and recipes

For a test or staging database only, run
`supabase/testing/seed_inventory_recipes.sql` after migrations 001–005. It adds
deterministic opening stock and recipes for the default coffee, sandwich, and
pastry menu. The quantities are testing assumptions—not the client's production
formulations—and rerunning the file resets the named test materials and recipes.
It is intentionally outside `supabase/migrations` and must not be included in a
production migration workflow.

The seed uses the client-mentioned **Oatside Milk** name. Product image paths
remain empty so the client can upload the actual menu photos in the Admin catalog.

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

## Install on a phone home screen

The Staff POS and Admin Inventory workspace are two roles inside the same web
application. This project is an installable Progressive Web App, not a separate
Android APK or iOS application.

- On Android Chrome, sign in and use **Add POS to home screen**, or open the
  browser menu and choose **Install app** / **Add to Home screen**.
- On iPhone or iPad, open the deployed site in Safari, tap **Share**, then
  **Add to Home Screen**.

Installation requires an HTTPS deployment (localhost is allowed during
development). The application shell can reopen from its cache, but authentication,
sales, and inventory updates still require an internet connection to Supabase.
The favicon and installed-app icons use the Halara Coffee Club main logo.

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
