# Halara Coffee Club POS and Inventory

A responsive thesis point-of-sale, inventory, notification, and reporting
application. The frontend is plain TypeScript/JavaScript, HTML, and CSS. Supabase
provides authentication, PostgreSQL data, row-level security, transactional
operations, and image storage.

## Supabase setup

1. Open the Supabase SQL Editor for the project.
2. Run the SQL files in `supabase/migrations` in numeric order. Existing
   installations should apply every newer numbered migration they have not yet
   run, through `009_project_keepalive.sql`.
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
prepared. Migration `005_inventory_tracking_scope.sql` introduced category-based
tracking and sale-item snapshots. Migration
`008_correct_inventory_tracking_scope.sql` applies the client's final
clarification: only Pastries and Pasta are not tracked; Espresso Based, Not
Coffee, Tea Refreshers and Soda, Add-ons, and Sandwiches require recipes. The
tracking decision is snapshotted on every sale item so historical
cancellation/restoration remains safe when rules change.

Migration `006_cash_reporting_realtime.sql` adds cashier shifts, auditable
cash-in/cash-out movements, tender and change snapshots, closed-drawer
reconciliation protection, weighted-average raw-material costing, and Realtime
publication registration. Every Cash, GCash, and Maya sale now requires the
staff member to open a shift first. Existing cash transactions are preserved as
legacy exact-payment sales without a shift. Apply this migration before using
the updated frontend because the old two-argument `create_sale` RPC is removed.
Payment submissions use a persisted client reference and a transaction-level
lock so retries or concurrent double-submissions return the same sale instead of
deducting inventory twice.

Migration `007_fix_create_sale_ambiguous_id.sql` qualifies product identifiers
inside the payment RPC. Existing databases that already applied migration 006
must apply migration 007 before processing another POS payment.

Migration `009_project_keepalive.sql` adds a read-only RPC for the deployed
Netlify site's scheduled keep-alive. The function returns only the database
time, is callable with the publishable key, and cannot read or modify business
data.

Administrators can assign a one-time starting unit cost to uncosted current
stock, then record the total purchase cost on every new stock entry. Inventory
reports clearly exclude uncosted materials from the valued total. Staff can
close and reconcile only their own drawer; administrators may inspect all
shifts and force-close an abandoned shift with a required note.

The Admin **Reports** workspace contains separate Sales and Inventory views and
sectioned PDF/CSV exports. Staff and Admin sales history can preview and reprint
itemized thermal receipts. Database changes are synchronized through authenticated
Supabase Realtime channels; the former 30-second notification polling loop is no
longer used.

### Test-only ingredients and recipes

For a test or staging database only, run
`supabase/testing/seed_inventory_recipes.sql` after migrations 001–008. It adds
deterministic opening stock and recipes for the default coffee and sandwich
menu. The quantities are testing assumptions—not the client's production
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

### Receipt printing on the Bluetooth tablet

**Print receipt** opens the browser's native print dialog on both desktop and
Android. Select the Bluetooth printer, keep an available roll size such as
**58mm Roll (default)**, then confirm **Print**. There is no app-picker, image
export, or requirement to open RTPrinter System. RTPrinter was provided as a
working hardware reference, not an integration requirement.

The RP30A-UB label specifies 80mm paper and ESC/POS, while the tablet's selected
Android print service currently advertises 58mm media. The receipt uses at most
80mm and fits narrower media selected by the service. It does not require an
80mm option in that dialog. Android print services supply those options; the
website cannot add them. See [Android printer capabilities](https://developer.android.com/reference/android/print/PrinterCapabilitiesInfo).

The print document is prepared when a receipt opens and frozen during the print
lifecycle. Background UI refreshes cannot replace it while Android prepares or
re-lays out the job. Receipt copies use normal block flow and can paginate on
short roll sizes. Individual item rows avoid page breaks where possible. The
viewport's screen height does not impose a minimum printed page height.

The optional checkout auto-print setting requests the same native dialog.
Confirm Print there; the website cannot silently submit a system print job or
verify that paper printed. The printer must be paired and available through the
selected, enabled Android print service. Printing inside another app uses a
separate path and does not verify Chrome's system print service.

For physical verification: open a saved order's receipt, tap Print receipt,
select Bluetooth Printer and the offered 58mm roll size, and tap the final Print
icon. Check both receipt copies, a long order, and cancellation/retry. If preview
renders but paper does not print, test a simple page from Chrome through the
same printer destination and inspect Android's print queue. Browser layout and
PDF checks cannot verify Bluetooth delivery. See [Chrome's Android printing instructions](https://support.google.com/chrome/answer/1069693?hl=en&co=GENIE.Platform%3DAndroid).

## Netlify deployment

The repository includes `netlify.toml`. Connect the GitHub repository in
Netlify and use the detected settings:

- Build command: `npm run build`
- Publish directory: `dist`

Every push to the production branch triggers a new deployment. Supabase keeps
the database, authentication records, and uploaded images independently of the
Netlify build.

### Supabase Free Plan keep-alive

The published Netlify deployment runs `supabase-keepalive` once daily at
03:17 UTC. It sends one small request to the read-only `project_keepalive` RPC
so the database receives regular activity even when nobody opens the POS.

Configure these variables in **Netlify → Project configuration → Environment
variables** before publishing migration 009 and the scheduled function:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

After the production deploy, open **Netlify → Functions → supabase-keepalive**
and use **Run now** once. A successful invocation confirms both the environment
variables and database migration are active. This reduces Free Plan inactivity
pausing risk, but only a paid Supabase plan guarantees that a production project
will not be paused.

## Validation

```sh
npm run typecheck
npm run build
```
