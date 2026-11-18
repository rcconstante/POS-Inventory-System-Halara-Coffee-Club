// Drives the mocked demo build and captures keyframes + click targets.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const SITE = path.join(ROOT, "site");
const OUT = path.join(ROOT, "shots");
const ORIGIN = "https://halara-coffee-club.netlify.app";
const DSF = 1.5;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const context = await browser.newContext({ deviceScaleFactor: DSF, serviceWorkers: "block", timezoneId: "Asia/Manila", locale: "en-PH", acceptDownloads: false });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort();
  let file = path.join(SITE, decodeURIComponent(url.pathname));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(SITE, "index.html");
  return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: mime[path.extname(file)] ?? "application/octet-stream" });
});

const steps = [];
let cur = null;
let n = 0;
const step = (o) => { cur = { ...o, events: [] }; steps.push(cur); };
const card = (o) => steps.push({ card: o, say: o.say, section: o.section });

async function shot(page) {
  await page.waitForTimeout(120);
  const file = `${String(n++).padStart(3, "0")}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 92, animations: "disabled", caret: "hide" });
  return file;
}
async function rectOf(page, locs) {
  const vp = page.viewportSize();
  const boxes = [];
  for (const l of [].concat(locs)) { const b = await l.boundingBox(); if (b) boxes.push(b); }
  if (!boxes.length) throw new Error("No box");
  let x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  let x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(vp.width, x1); y1 = Math.min(vp.height, y1);
  return [x0 * DSF, y0 * DSF, (x1 - x0) * DSF, (y1 - y0) * DSF];
}
async function click(page, loc, o = {}) {
  await loc.scrollIntoViewIfNeeded();
  const before = await shot(page);
  const rect = await rectOf(page, loc);
  await loc.click(o.position ? { position: o.position } : undefined);
  await page.waitForTimeout(o.wait ?? 800);
  const after = await shot(page);
  cur.events.push({ type: "click", before, after, rect, label: o.label, stay: o.stay });
}
async function type(page, loc, text, o = {}) {
  await loc.scrollIntoViewIfNeeded();
  const before = await shot(page);
  const rect = await rectOf(page, loc);
  await loc.fill("");
  await loc.pressSequentially(text, { delay: 20 });
  if (o.blur) await loc.blur();
  await page.waitForTimeout(250);
  const after = await shot(page);
  cur.events.push({ type: "type", before, after, rect, label: o.label, stay: o.stay ?? true });
}
async function focus(page, locs, o = {}) {
  const first = [].concat(locs)[0];
  if (!o.noScroll) await first.scrollIntoViewIfNeeded();
  const img = await shot(page);
  cur.events.push({ type: "focus", before: img, after: img, rect: await rectOf(page, locs), label: o.label });
}
async function show(page) { const img = await shot(page); cur.events.push({ type: "show", before: img, after: img }); }

// ---------------------------------------------------------------- Tablet (Android staff app)
const tablet = await context.newPage();
await tablet.setViewportSize({ width: 1280, height: 800 });
await tablet.addInitScript(() => {
  window.HalaraNative = { version: 1 };
  window.ReactNativeWebView = {
    postMessage(raw) {
      const r = JSON.parse(raw);
      setTimeout(() => window.dispatchEvent(new CustomEvent("halara-native-response", { detail: { version: 1, id: r.id, success: true, message: r.action === "print" ? "Receipt sent to the Bluetooth printer (customer + store copy)." : "Printer selected: RP30A-UB." } })), 900);
    },
  };
});
await tablet.goto(`${ORIGIN}/?halaraApp=staff`);
await tablet.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await tablet.reload();
await tablet.waitForSelector("#login-form");
await tablet.waitForTimeout(600);

card({ kind: "title", section: "Introduction", say: "This is the Halara Coffee Club Point of Sale and Inventory System. It has two parts: an Android tablet app for the staff, and a web dashboard for the admin. Let's walk through every feature." });
card({ kind: "section", section: "Part 1 · Staff Tablet App", title: "Part 1", subtitle: "Staff POS on the Android tablet", say: "Part one. The staff point of sale, running on the Android tablet." });

step({ device: "tablet", section: "Tablet · Sign in", say: "Staff sign in with their own account. For this demo, we tap the demo credentials and sign in." });
await click(tablet, tablet.locator("#fill-demo"), { stay: true });
await click(tablet, tablet.locator("#login-form button[type=submit]"), { wait: 1500 });

step({ device: "tablet", section: "Tablet · Home", say: "The home screen shows today's sales, number of transactions, and low-stock alerts at a glance." });
await focus(tablet, tablet.locator(".staff-metrics"));

step({ device: "tablet", section: "Tablet · Cash shift", say: "Before taking any order, the cashier must open a shift. This makes every payment traceable to a cashier and a cash drawer." });
await click(tablet, tablet.locator('.staff-nav [data-staff-view="products"]'));
await focus(tablet, tablet.locator(".cash-gate"));

step({ device: "tablet", section: "Tablet · Cash shift", say: "The cashier enters the starting cash in the drawer, one thousand pesos, and opens the shift." });
await click(tablet, tablet.locator('.cash-gate [data-staff-view="cash"]'));
await click(tablet, tablet.locator('[data-action="open-shift"]'));
await type(tablet, tablet.locator('[name="openingBalance"]'), "1000");
await click(tablet, tablet.locator('#dialog-form [type="submit"]'), { wait: 1300 });

step({ device: "tablet", section: "Tablet · Menu", say: "Now we can take orders. Each menu item shows its price, and how many servings can still be made, based on its recipe and the ingredients in stock." });
await click(tablet, tablet.locator('.staff-nav [data-staff-view="products"]'));
await focus(tablet, tablet.locator(".staff-product", { hasText: "Café Latte" }).locator("small"), { label: "Servings left" });

step({ device: "tablet", section: "Tablet · Menu", say: "If an ingredient runs out, like the ham for this sandwich, the item is disabled automatically, so staff can't sell what the kitchen can't make." });
await tablet.locator(".staff-product", { hasText: "Ham & Cheese" }).scrollIntoViewIfNeeded();
await focus(tablet, tablet.locator(".staff-product", { hasText: "Ham & Cheese" }), { label: "Sold out" });

step({ device: "tablet", section: "Tablet · Taking an order", say: "Staff can filter by category. Tapping the plus button adds an item to the order." });
await tablet.evaluate(() => window.scrollTo(0, 0));
await click(tablet, tablet.locator("[data-pos-category]", { hasText: "Espresso Based" }));
await click(tablet, tablet.locator(".staff-product", { hasText: "Café Latte" }).locator('[data-action="add-cart"]'), { wait: 600 });
await click(tablet, tablet.locator(".staff-product", { hasText: "Caramel Macchiato" }).locator('[data-action="add-cart"]'), { wait: 600 });
await click(tablet, tablet.locator("[data-pos-category]", { hasText: "Pastries" }));
await click(tablet, tablet.locator(".staff-product", { hasText: "Butter Croissant" }).locator('[data-action="add-cart"]'), { wait: 600 });

step({ device: "tablet", section: "Tablet · Cart", say: "In the cart, the cashier reviews the order and adjusts quantities." });
await click(tablet, tablet.locator(".cart-button"));
await click(tablet, tablet.locator(".cart-lines article", { hasText: "Café Latte" }).locator('[data-action="cart-plus"]'), { wait: 500 });

step({ device: "tablet", section: "Tablet · Payment", say: "Three payment methods are supported: Cash, G-Cash, and Maya. For cash, quick-amount buttons compute the change instantly." });
await click(tablet, tablet.locator('.staff-flow > button[data-staff-view="payment"]'));
await click(tablet, tablet.locator('[data-payment="Cash"]'));
await click(tablet, tablet.locator('[data-cash-amount="1000"]'));
await focus(tablet, tablet.locator(".cash-payment-fields"), { label: "Change" });

step({ device: "tablet", section: "Tablet · Receipt", say: "When payment is confirmed, the sale is saved, the recipe ingredients are deducted from inventory automatically, and the receipt prints directly to the Bluetooth thermal printer." });
await click(tablet, tablet.locator('[data-action="confirm-payment"]'), { wait: 2600 });
await focus(tablet, [tablet.locator(".success-mark"), tablet.locator(".toast").last()], { label: "Saved & printing" });

step({ device: "tablet", section: "Tablet · G-Cash / Maya", say: "For G-Cash or Maya, the store's QR code is shown to the customer. The cashier confirms only after checking that the payment really arrived." });
await click(tablet, tablet.locator('[data-action="new-order"]'));
await click(tablet, tablet.locator("[data-pos-category]", { hasText: "Not Coffee" }));
await click(tablet, tablet.locator(".staff-product", { hasText: "Matcha Latte" }).locator('[data-action="add-cart"]'), { wait: 600 });
await click(tablet, tablet.locator(".cart-button"));
await click(tablet, tablet.locator('.staff-flow > button[data-staff-view="payment"]'));
await click(tablet, tablet.locator('[data-payment="GCash"]'));
await click(tablet, tablet.locator('[data-action="confirm-payment"]'), { wait: 1500 });
await focus(tablet, tablet.locator(".payment-qr-checkout"), { label: "Store QR" });
await click(tablet, tablet.locator(".qr-confirm"), { stay: true });
await click(tablet, tablet.locator('#dialog-form [type="submit"]'), { wait: 2600 });

step({ device: "tablet", section: "Tablet · Orders", say: "The Orders screen lists every transaction. Any receipt can be reprinted, and an order can be refunded, which returns its ingredients to stock." });
await tablet.locator('[data-action="new-order"]').click(); await tablet.waitForTimeout(600);
await click(tablet, tablet.locator('.staff-nav [data-staff-view="orders"]'), { wait: 900 });
await focus(tablet, tablet.locator(".mobile-order-list article").first().locator(".row-actions"), { label: "Reprint · Refund" });
await click(tablet, tablet.locator(".mobile-order-list article").nth(1).locator('[data-action="view-receipt"]'), { wait: 900 });

step({ device: "tablet", section: "Tablet · Inventory", say: "Staff can also check raw material stock, with clear low-stock and out-of-stock labels." });
await click(tablet, tablet.locator(".modal-close"), { wait: 500 });
await click(tablet, tablet.locator('.staff-nav [data-staff-view="inventory"]'));
await focus(tablet, tablet.locator(".mobile-inventory article", { hasText: "Oatside Milk" }), { label: "Low stock" });

step({ device: "tablet", section: "Tablet · Close shift", say: "At the end of the shift, the drawer shows the expected cash. The cashier counts the money and closes the shift, and the system records any difference." });
await click(tablet, tablet.locator('.staff-nav [data-staff-view="cash"]'));
await focus(tablet, tablet.locator(".cash-metrics"), { label: "Expected cash" });
await click(tablet, tablet.locator('[data-action="close-shift"]'));
const expected = await tablet.locator(".cash-reconcile-preview strong").innerText();
await type(tablet, tablet.locator('[name="countedCash"]'), expected.replace(/[^0-9.]/g, ""));
await click(tablet, tablet.locator('#dialog-form [type="submit"]'), { wait: 1300 });

// ---------------------------------------------------------------- Web (Admin dashboard)
const web = await context.newPage();
await web.setViewportSize({ width: 1280, height: 720 });
await web.goto(`${ORIGIN}/`);
await web.waitForSelector("[data-role]");
await web.waitForTimeout(600);

card({ kind: "section", section: "Part 2 · Admin Web Dashboard", title: "Part 2", subtitle: "Admin dashboard on the web", say: "Part two. The admin web dashboard, where the business is managed." });

step({ device: "web", section: "Web · Sign in", say: "On the web, users first choose their role. The admin signs in with an admin account; staff accounts cannot open the admin side." });
await focus(web, web.locator(".role-grid"));
await click(web, web.locator('[data-role="admin"]'));
await click(web, web.locator("#fill-demo"), { stay: true });
await click(web, web.locator("#login-form button[type=submit]"), { wait: 1500 });

step({ device: "web", section: "Web · Dashboard", say: "The dashboard summarizes total sales, transactions, stock alerts, and products. The orders we just made on the tablet already appear here, synced in real time." });
await focus(web, web.locator(".metric-grid"));
await focus(web, web.locator(".dashboard-grid .panel").first(), { label: "Tablet orders" });

step({ device: "web", section: "Web · Notifications", say: "Low-stock and out-of-stock notifications are created automatically whenever an ingredient falls below its alert level." });
await click(web, web.locator('.topbar [data-action="notifications"]'), { wait: 700, position: { x: 8, y: 8 } });
await focus(web, web.locator(".notification-popover"));
await click(web, web.locator('[data-action="close-notifications"]'), { wait: 400 });

step({ device: "web", section: "Web · Sales", say: "The Sales page lists all transactions. The admin can search, view receipts, export to CSV, and cancel or refund an order." });
await click(web, web.locator('.sidebar [data-route="sales"]'));
await focus(web, [web.locator('[data-action="sales-csv"]'), web.locator(".filter-bar")], { label: "Search & export" });
await click(web, web.locator('[data-action="view-receipt"]').first(), { wait: 900 });
await click(web, web.locator(".modal-close"), { wait: 500 });

step({ device: "web", section: "Web · Products & recipes", say: "In Products, every menu item has a recipe per serving. This recipe is what connects each sale to the inventory." });
await click(web, web.locator('.sidebar [data-route="products"]'));
await focus(web, web.locator("tbody tr", { hasText: "Café Latte" }), { label: "Recipe per serving" });
await click(web, web.locator("tbody tr", { hasText: "Café Latte" }).locator('[data-action="edit-product"]'), { wait: 900 });
await focus(web, web.locator("#recipe-editor-fieldset"), { label: "Ingredients per cup" });
await click(web, web.locator(".modal-close"), { wait: 500 });

step({ device: "web", section: "Web · Raw materials", say: "Raw materials are tracked in their own units, such as grams, milliliters, or pieces, each with its own low-stock level." });
await click(web, web.locator('[data-product-tab="raw_material"]'));
await focus(web, web.locator("table"), { label: "Stock status" });

step({ device: "web", section: "Web · Inventory", say: "When a delivery arrives, the admin records the stock and its purchase cost. Here we add five liters of oat milk." });
await click(web, web.locator('.sidebar [data-route="inventory"]'));
await click(web, web.locator('.page-heading [data-action="add-stock"]'), { wait: 800 });
await web.locator('[name="productId"]').selectOption("r-oat");
await type(web, web.locator('[name="quantity"]'), "5000");
await type(web, web.locator('[name="totalCost"]'), "900");
await type(web, web.locator('[name="note"]'), "Oatside supplier delivery");
await click(web, web.locator('#dialog-form [type="submit"]'), { wait: 1300 });

step({ device: "web", section: "Web · Inventory valuation", say: "Stock goes up immediately, the low-stock alert clears, and the system keeps a weighted-average cost to value the whole inventory." });
await focus(web, web.locator(".valuation-table tbody tr", { hasText: "Oatside Milk" }), { label: "Updated stock & cost" });

step({ device: "web", section: "Web · Cash management", say: "Cash Management shows every cashier shift: the opening balance, cash sales, expected and counted cash, and the variance." });
await click(web, web.locator('.sidebar [data-route="cash"]'));
await focus(web, web.locator(".table-panel tbody tr").first(), { label: "Today's shift" });
await click(web, web.locator('[data-action="shift-details"]').first(), { wait: 800 });
await click(web, web.locator(".modal-close"), { wait: 500 });

step({ device: "web", section: "Web · Reports", say: "Reports show revenue per day, the top-selling products, and the mix of payment methods for any date range." });
await click(web, web.locator('.sidebar [data-route="reports"]'), { wait: 1200 });
await focus(web, web.locator(".report-metrics"));
await focus(web, web.locator(".report-grid"), { label: "Revenue · Top sellers · Payments", noScroll: false });

step({ device: "web", section: "Web · Reports", say: "The inventory report covers stock value, deliveries, ingredient usage, and alert history. Both reports can be exported as PDF or CSV." });
await web.evaluate(() => window.scrollTo(0, 0));
await click(web, web.locator('[data-report-tab="inventory"]'), { wait: 1200 });
await click(web, web.locator('[data-action="generate-report"]'), { wait: 800 });
await focus(web, web.locator(".export-options"), { label: "PDF · CSV" });
await click(web, web.locator(".modal-close"), { wait: 500 });

step({ device: "web", section: "Web · Settings", say: "Finally, in Settings, the admin updates their profile and password, and uploads the G-Cash and Maya QR codes that the tablet shows at checkout." });
await click(web, web.locator('.sidebar [data-route="settings"]'), { wait: 900 });
await focus(web, web.locator("#gcash-qr-form").locator("xpath=.."), { label: "Shared payment QR" });

card({ kind: "outro", section: "Summary", say: "In summary: a complete point of sale with Cash, G-Cash and Maya; recipe-based automatic inventory deduction; low-stock alerts; cashier shift reconciliation; reports with PDF and CSV export; and direct Bluetooth receipt printing. Thank you." });

fs.writeFileSync(path.join(ROOT, "timeline.json"), JSON.stringify(steps, null, 2));
console.log("steps", steps.length, "shots", n);
await browser.close();
