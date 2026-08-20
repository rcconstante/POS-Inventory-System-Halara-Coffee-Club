import "./styles.css";
import {
  ArrowLeft, BarChart3, Bell, Box, Boxes, Check, ChevronDown, CircleAlert, CircleCheck,
  Coffee, Download, Eye, EyeOff, FileText, LayoutDashboard, LoaderCircle, LogOut, Menu,
  Minus, PackagePlus, Plus, Printer, Receipt, Search, Settings, ShieldCheck, ShoppingCart,
  Tag, Trash2, Truck, Upload, UserRound, WalletCards, X, createIcons, type Icons,
} from "lucide";
import {
  api, type AppData, type Category, type NotificationItem, type PaymentMethod, type Product,
  type ReportSummary, type Sale, type SaleStatus, type UserRole,
  type UserSession,
} from "./api";

const logoUrl = new URL("../assets/Logo.webp", import.meta.url).href;
const loginHeroUrl = new URL("../assets/login-right.webp", import.meta.url).href;
const cashLogoUrl = new URL("../assets/money.webp", import.meta.url).href;
const gcashLogoUrl = new URL("../assets/GCash_logo.svg.webp", import.meta.url).href;
const mayaLogoUrl = new URL("../assets/maya.webp", import.meta.url).href;
const adminRoleUrl = new URL("../assets/Admin.png", import.meta.url).href;
const staffRoleUrl = new URL("../assets/Staff.png", import.meta.url).href;

const icons: Icons = {
  ArrowLeft, BarChart3, Bell, Box, Boxes, Check, ChevronDown, CircleAlert, CircleCheck,
  Coffee, Download, Eye, EyeOff, FileText, LayoutDashboard, LoaderCircle, LogOut, Menu,
  Minus, PackagePlus, Plus, Printer, Receipt, Search, Settings, ShieldCheck, ShoppingCart,
  Tag, Trash2, Truck, Upload, UserRound, WalletCards, X,
};

type AdminRoute = "dashboard" | "sales" | "products" | "inventory" | "reports" | "settings";
type ProductTab = "finished_product" | "raw_material" | "categories";
type StaffView = "dashboard" | "products" | "cart" | "payment" | "success" | "orders" | "inventory" | "account";
type ToastKind = "success" | "error" | "info";

const adminRoutes: readonly AdminRoute[] = ["dashboard", "sales", "products", "inventory", "reports", "settings"];
const staffViews: readonly StaffView[] = ["dashboard", "products", "cart", "payment", "success", "orders", "inventory", "account"];
const posStateKey = "halara-pos-workflow";

interface CartItem { productId: string; quantity: number }

interface UiState {
  session: UserSession | null;
  roleChoice: UserRole | null;
  data: AppData;
  notifications: NotificationItem[];
  unread: number;
  route: AdminRoute;
  productTab: ProductTab;
  staffView: StaffView;
  navOpen: boolean;
  accountOpen: boolean;
  notificationsOpen: boolean;
  loading: boolean;
  cart: CartItem[];
  selectedPayment: PaymentMethod | null;
  completedSale: Sale | null;
  reportRange: { from: string; to: string };
  report: ReportSummary | null;
  reportLoading: boolean;
  productSearch: string;
  posSearch: string;
  posCategory: string;
}

const emptyData = (): AppData => ({ categories: [], products: [], stockMovements: [], sales: [] });

function manilaDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const ui: UiState = {
  session: null,
  roleChoice: null,
  data: emptyData(),
  notifications: [],
  unread: 0,
  route: "dashboard",
  productTab: "finished_product",
  staffView: "dashboard",
  navOpen: false,
  accountOpen: false,
  notificationsOpen: false,
  loading: true,
  cart: [],
  selectedPayment: null,
  completedSale: null,
  reportRange: { from: manilaDate(-6), to: manilaDate() },
  report: null,
  reportLoading: false,
  productSearch: "",
  posSearch: "",
  posCategory: "all",
};

const app = required<HTMLDivElement>("#app");
const modalRoot = required<HTMLDivElement>("#modal-root");
const toastRegion = required<HTMLDivElement>("#toast-region");
let notificationTimer: number | undefined;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function icon(name: string, className = ""): string {
  return `<i data-lucide="${escapeHtml(name)}" class="${escapeHtml(className)}"></i>`;
}

function hydrate(root: HTMLElement | Document = document): void {
  createIcons({ icons, attrs: { "aria-hidden": "true", "stroke-width": 1.9 }, nameAttr: "data-lucide", root });
}

const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const number = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 });
const compactDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? value : compactDate.format(date);
}

function categoryName(id: string): string {
  return ui.data.categories.find((category) => category.id === id)?.name ?? "Uncategorized";
}

function stockStatus(product: Product): "Available" | "Low stock" | "Out of stock" {
  if (product.currentStock <= 0) return "Out of stock";
  return product.currentStock <= product.lowStockThreshold ? "Low stock" : "Available";
}

function saleTotal(sale: Sale): number {
  return sale.total ?? sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function productVisual(product: Product, large = false): string {
  if (product.currentStock <= 0) return "Out of stock";
  return product.currentStock <= product.lowStockThreshold ? "Low stock" : "Available";
}

function saleTotal(sale: Sale): number {
  return sale.total ?? sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function productVisual(product: Product, large = false): string {
  return product.imageUrl
    ? `<img class="product-photo ${large ? "large" : ""}" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" />`
    : `<span class="product-fallback ${large ? "large" : ""}">${icon("Coffee")}</span>`;
}

function avatarMarkup(session: UserSession, className = "avatar-circle"): string {
  const defaultAvatar = session.role === "admin" ? adminRoleUrl : staffRoleUrl;
  const avatarSrc = session.avatarUrl || defaultAvatar;
  return `<img class="${className}" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(session.displayName)}" />`;
}

function rawMaterials(): Product[] {
  return ui.data.products.filter((product) => product.type === "raw_material");
}

function finishedProducts(): Product[] {
  return ui.data.products.filter((product) => product.type === "finished_product");
}

function locationParts(): string[] {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

function writeLocation(path: string, replace = false): void {
  const next = `#/${path}`;
  if (window.location.hash === next) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", next);
}

function restoreLocationState(): void {
  const [area, view] = locationParts();
  if (!ui.session) {
    ui.roleChoice = area === "login" && (view === "admin" || view === "staff") ? view : null;
    return;
  }
  if (ui.session.role === "admin") {
    ui.route = area === "admin" && adminRoutes.includes(view as AdminRoute) ? view as AdminRoute : "dashboard";
    return;
  }
  const requested = area === "staff" && staffViews.includes(view as StaffView) ? view as StaffView : "dashboard";
  ui.staffView = requested === "payment" && !ui.cart.length
    ? "products"
    : requested === "success" && !ui.completedSale
      ? "orders"
      : requested;
}

function syncLocation(replace = false): void {
  if (!ui.session) writeLocation(ui.roleChoice ? `login/${ui.roleChoice}` : "access", replace);
  else if (ui.session.role === "admin") writeLocation(`admin/${ui.route}`, replace);
  else writeLocation(`staff/${ui.staffView}`, replace);
}

function restorePosState(): void {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(posStateKey) ?? "null") as {
      cart?: CartItem[];
      selectedPayment?: PaymentMethod | null;
      completedSaleId?: string | null;
    } | null;
    const remaining = new Map(rawMaterials().map((material) => [material.id, material.currentStock]));
    ui.cart = [];
    for (const item of saved?.cart ?? []) {
      const product = ui.data.products.find((candidate) => candidate.id === item.productId);
      if (!product || product.type !== "finished_product" || !product.recipe.length || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
      const available = Math.max(0, Math.min(...product.recipe.map((recipe) => Math.floor((remaining.get(recipe.ingredientId) ?? 0) / recipe.quantity))));
      const quantity = Math.min(item.quantity, available);
      if (quantity <= 0) continue;
      ui.cart.push({ productId: item.productId, quantity });
      for (const recipe of product.recipe) remaining.set(recipe.ingredientId, (remaining.get(recipe.ingredientId) ?? 0) - recipe.quantity * quantity);
    }
    ui.selectedPayment = saved?.selectedPayment === "Cash" || saved?.selectedPayment === "GCash" || saved?.selectedPayment === "Maya" ? saved.selectedPayment : null;
    ui.completedSale = saved?.completedSaleId ? ui.data.sales.find((sale) => sale.id === saved.completedSaleId) ?? null : null;
  } catch {
    window.sessionStorage.removeItem(posStateKey);
  }
}

function persistPosState(): void {
  window.sessionStorage.setItem(posStateKey, JSON.stringify({
    cart: ui.cart,
    selectedPayment: ui.selectedPayment,
    completedSaleId: ui.completedSale?.id ?? null,
  }));
}

async function bootstrap(): Promise<void> {
  renderLoading("Opening your workspace");
  try {
    ui.session = await api.session();
    await refreshAll(false);
    restorePosState();
    restoreLocationState();
    syncLocation(true);
    if (ui.session.role === "admin" && ui.route === "reports") {
      try { ui.report = await api.report(ui.reportRange.from, ui.reportRange.to); }
      catch { ui.report = null; }
    }
    startNotificationPolling();
  } catch {
    ui.session = null;
    restoreLocationState();
    syncLocation(true);
  } finally {
    ui.loading = false;
    render();
  }
}

async function refreshAll(shouldRender = true): Promise<void> {
  const [data, notificationData] = await Promise.all([api.appData(), api.notifications()]);
  ui.data = data;
  ui.notifications = notificationData.notifications;
  ui.unread = notificationData.unread;
  if (shouldRender) render();
}

function startNotificationPolling(): void {
  window.clearInterval(notificationTimer);
  notificationTimer = window.setInterval(async () => {
    if (!ui.session || document.hidden) return;
    try {
      const result = await api.notifications();
      ui.notifications = result.notifications;
      ui.unread = result.unread;
      const badge = document.querySelector<HTMLElement>("[data-notification-count]");
      if (badge) badge.textContent = result.unread ? String(result.unread) : "";
    } catch { /* The next refresh retries quietly. */ }
  }, 30_000);
}

function renderLoading(message: string): void {
  app.innerHTML = `<main class="loading-screen"><img src="${logoUrl}" alt="Company logo" /><span>${icon("LoaderCircle", "spin")}</span><p>${escapeHtml(message)}</p></main>`;
  hydrate(app);
}

function render(): void {
  document.body.className = ui.session ? (ui.session.role === "staff" ? "staff-page" : "app-page") : "login-page";
  if (!ui.session) renderAccess();
  else if (ui.session.role === "admin") renderAdmin();
  else renderStaff();
}

function renderAccess(): void {
  if (!ui.roleChoice) {
    app.innerHTML = `
      <main class="access-page" id="main-content">
        <section class="access-card">
          <img class="access-logo" src="${logoUrl}" alt="Company logo" />
          <div class="access-heading"><p>Secure cloud workspace</p><h1>Choose how you want to sign in</h1><span>Use the dashboard to manage the business or open the tablet POS.</span></div>
          <div class="role-grid">
            ${roleCard("admin", "ShieldCheck", "Admin", "Products, inventory, sales, reports and settings")}
            ${roleCard("staff", "UserRound", "Staff", "Orders, payments, receipts and stock visibility")}
          </div>
        </section>
      </main>`;
    hydrate(app);
    document.querySelectorAll<HTMLButtonElement>("[data-role]").forEach((button) => button.addEventListener("click", () => {
      ui.roleChoice = button.dataset.role as UserRole; syncLocation(); renderAccess();
    }));
    return;
  }

  const isAdmin = ui.roleChoice === "admin";
  const demoEmail = isAdmin ? "admin@halara.test" : "staff@halara.test";
  const demoPassword = isAdmin ? "Admin@12345!" : "Staff@12345!";
  app.innerHTML = `
    <main class="login-shell" id="main-content">
      <section class="login-panel">
        <div class="login-content">
          <button class="back-link" id="back-role" type="button">${icon("ArrowLeft")} Choose another role</button>
          <img class="login-logo" src="${logoUrl}" alt="Company logo" />
          <div class="login-heading"><h1>${isAdmin ? "Admin" : "Staff"} sign in</h1><p>${isAdmin ? "Manage operations and business performance." : "Open the point-of-sale workspace."}</p></div>
          <form id="login-form" class="login-form" novalidate>
            <label class="field"><span>Email address</span><input name="email" type="email" autocomplete="email" placeholder="name@example.com" required /><small class="field-error" data-error="email"></small></label>
            <label class="field"><span>Password</span><div class="password-input"><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /><button type="button" data-password-toggle="login-password" aria-label="Show password">${icon("Eye")}</button></div><small class="field-error" data-error="password"></small></label>
            <p class="form-message" id="login-error" role="alert"></p>
            <button class="button primary wide" type="submit">Sign in</button>
          </form>
          <aside class="demo-access" aria-label="Thesis demo credentials">
            <div><span>${icon("ShieldCheck")}</span><strong>Thesis demo access</strong></div>
            <button type="button" id="fill-demo" data-email="${demoEmail}" data-password="${demoPassword}">
              <span><small>Email</small><b>${demoEmail}</b></span><span><small>Default password</small><b>${demoPassword}</b></span><em>Use credentials</em>
            </button>
            <p>If the password was changed in Settings, use the updated password instead.</p>
          </aside>
        </div>
      </section>
      <section class="login-visual"><img src="${loginHeroUrl}" alt="Coffee cup on a wooden table" /></section>
    </main>`;
  hydrate(app);
  bindLogin();
}

function roleCard(role: UserRole, iconName: string, title: string, copy: string): string {
  return `<button class="role-card" type="button" data-role="${role}"><span>${icon(iconName)}</span><div><strong>${title}</strong><small>${copy}</small></div><i>${icon("ArrowLeft")}</i></button>`;
}

function bindLogin(): void {
  document.querySelector("#back-role")?.addEventListener("click", () => { ui.roleChoice = null; syncLocation(); renderAccess(); });
  bindPasswordToggles(document.querySelector("#login-form") ?? document);
  document.querySelector("#fill-demo")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const email = document.querySelector<HTMLInputElement>('[name="email"]');
    const password = document.querySelector<HTMLInputElement>('[name="password"]');
    if (email) email.value = button.dataset.email ?? "";
    if (password) password.value = button.dataset.password ?? "";
  });
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    setButtonBusy(submit, true, "Signing in");
    setText("#login-error", "");
    try {
      ui.session = await api.login(ui.roleChoice!, email, password);
      ui.route = "dashboard"; ui.staffView = "dashboard";
      syncLocation(true);
      await refreshAll(false); startNotificationPolling(); render();
      toast("Signed in successfully.", "success");
    } catch (error) {
      setText("#login-error", errorMessage(error));
      setButtonBusy(submit, false, "Sign in");
    }
  });
}

function renderAdmin(): void {
  const session = ui.session!;
  app.innerHTML = `
    <div class="admin-shell">
      <button class="nav-scrim ${ui.navOpen ? "show" : ""}" id="nav-scrim" aria-label="Close navigation"></button>
      <aside class="sidebar ${ui.navOpen ? "show" : ""}">
        <div class="sidebar-logo"><img src="${logoUrl}" alt="Company logo" /><button id="close-nav" aria-label="Close menu">${icon("X")}</button></div>
        <nav>
          ${adminNav("dashboard", "LayoutDashboard", "Dashboard")}
          ${adminNav("sales", "Receipt", "Sales")}
          ${adminNav("products", "Box", "Products")}
          ${adminNav("inventory", "Truck", "Inventory")}
          ${adminNav("reports", "BarChart3", "Reports")}
          ${adminNav("settings", "Settings", "Settings")}
        </nav>
        <div class="database-status"><i></i><span><strong>Supabase</strong><small>Connected and persistent</small></span></div>
      </aside>
      <div class="admin-area">
        <header class="topbar">
          <button class="menu-button" id="open-nav" aria-label="Open menu">${icon("Menu")}</button>
          <div class="topbar-title"><p>Workspace</p><h1>${adminTitle()}</h1></div>
          <div class="topbar-actions">
            <span class="topbar-date">${formatDate(ui.reportRange.from)} – ${formatDate(ui.reportRange.to)}</span>
            <div class="notification-wrap"><button class="notification-button" data-action="notifications" aria-label="Open notifications" aria-expanded="${ui.notificationsOpen}">${icon("Bell")}<b data-notification-count>${ui.unread || ""}</b></button>${ui.notificationsOpen ? renderNotificationPopover() : ""}</div>
            <div class="account-wrap">
              <button class="account-button" id="account-button">${avatarMarkup(session)}<div><strong>${escapeHtml(session.displayName)}</strong><small>Contributor</small></div>${icon("ChevronDown")}</button>
              <div class="account-menu ${ui.accountOpen ? "show" : ""}" id="account-menu"><button data-route="settings">${icon("Settings")} Account settings</button><button data-action="logout">${icon("LogOut")} Sign out</button></div>
            </div>
          </div>
        </header>
        <main class="main-content" id="main-content">${renderAdminRoute()}</main>
      </div>
    </div>`;
  hydrate(app); bindAdmin();
}

function adminNav(route: AdminRoute, iconName: string, label: string): string {
  return `<button data-route="${route}" class="${ui.route === route ? "active" : ""}" ${ui.route === route ? 'aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span></button>`;
}

function adminTitle(): string {
  return ({ dashboard: "Dashboard overview", sales: "Sales management", products: "Product management", inventory: "Stock management", reports: "Sales reports", settings: "Settings" } satisfies Record<AdminRoute, string>)[ui.route];
}

function renderAdminRoute(): string {
  if (ui.route === "dashboard") return renderDashboard();
  if (ui.route === "sales") return renderSales();
  if (ui.route === "products") return renderProductsManagement();
  if (ui.route === "inventory") return renderInventory();
  if (ui.route === "reports") return renderReports();
  return renderSettings();
}

function pageHeading(kicker: string, title: string, description: string, action = ""): string {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2><span>${escapeHtml(description)}</span></div>${action}</div>`;
}

function metric(label: string, value: string, note: string, iconName: string, tone = ""): string {
  return `<article class="metric-card ${tone}"><div><span>${escapeHtml(label)}</span><i>${icon(iconName)}</i></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function renderDashboard(): string {
  const completed = ui.data.sales.filter((sale) => sale.status === "Completed" && sale.date >= ui.reportRange.from && sale.date <= ui.reportRange.to);
  const total = completed.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const alerts = rawMaterials().filter((product) => stockStatus(product) !== "Available");
  return `<section class="page-section">
    ${pageHeading("Live operations", "Business at a glance", "Real-time data from Supabase")}
    <div class="metric-grid">${metric("Total sales", money.format(total), "Selected 7-day period", "BarChart3", "accent")}${metric("Transactions", String(completed.length), "Completed orders", "Receipt")}${metric("Stock alerts", String(alerts.length), alerts.length ? "Needs attention" : "Inventory healthy", "CircleAlert", alerts.length ? "warning" : "success")}${metric("Products", String(ui.data.products.length), "Active catalog items", "Box")}</div>
    <div class="dashboard-grid">
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">Recent activity</p><h3>Latest sales</h3></div><button class="text-button" data-route="sales">View all</button></div>${salesTable(ui.data.sales.slice(0, 5), true)}</article>
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">Inventory</p><h3>Stock requiring attention</h3></div><button class="text-button" data-route="inventory">Manage</button></div><div class="alert-list">${alerts.length ? alerts.slice(0, 6).map((product) => `<button data-route="inventory"><span class="mini-product">${productVisual(product)}</span><div><strong>${escapeHtml(product.name)}</strong><small>${number.format(product.currentStock)} ${escapeHtml(product.unit)} remaining</small></div>${statusPill(stockStatus(product))}</button>`).join("") : emptyState("CircleCheck", "Inventory is healthy", "No products are below their threshold.")}</div></article>
    </div>
    <article class="panel quick-panel"><div class="panel-heading"><div><p class="eyebrow">Shortcuts</p><h3>Quick actions</h3></div></div><div class="quick-actions"><button data-action="add-product">${icon("PackagePlus")}<span><strong>Add product</strong><small>Create a catalog item</small></span></button><button data-action="add-stock">${icon("Truck")}<span><strong>Add stock</strong><small>Record a delivery</small></span></button><button data-route="reports">${icon("FileText")}<span><strong>Generate report</strong><small>PDF or CSV</small></span></button></div></article>
  </section>`;
}

function renderSales(): string {
  return `<section class="page-section">${pageHeading("Transactions", "Sales records", "Review, search, export, and update transaction status", `<button class="button secondary" data-action="sales-csv">${icon("Download")} Export CSV</button>`)}
    <div class="filter-bar"><label class="search-box">${icon("Search")}<input id="sales-search" placeholder="Search receipt or payment method" /></label><select id="sales-status"><option value="all">All statuses</option><option>Completed</option><option>Cancelled</option></select></div>
    <article class="table-panel" id="sales-table">${salesTable(ui.data.sales)}</article></section>`;
}

function salesTable(sales: Sale[], compact = false): string {
  if (!sales.length) return emptyState("Receipt", "No sales yet", "Completed POS orders will appear here.");
  return `<div class="table-scroll"><table><thead><tr><th>Receipt</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th>${compact ? "" : "<th>Action</th>"}</tr></thead><tbody>${sales.map((sale) => `<tr data-sale-row data-search="${escapeHtml(`${sale.receipt} ${sale.payment} ${sale.status}`.toLowerCase())}" data-status="${sale.status}"><td data-label="Receipt"><strong>${escapeHtml(sale.receipt)}</strong></td><td data-label="Date">${formatDate(sale.date)}</td><td data-label="Items">${sale.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td data-label="Total"><strong>${money.format(saleTotal(sale))}</strong></td><td data-label="Payment">${escapeHtml(sale.payment)}</td><td data-label="Status">${statusPill(sale.status)}</td>${compact ? "" : `<td data-label="Action"><button class="small-button" data-action="sale-status" data-id="${sale.id}" data-status="${sale.status === "Completed" ? "Cancelled" : "Completed"}">${sale.status === "Completed" ? "Cancel / refund" : "Restore"}</button></td>`}</tr>`).join("")}</tbody></table></div>`;
}

function renderProductsManagement(): string {
  const tabs = `<div class="tabs"><button data-product-tab="finished_product" class="${ui.productTab === "finished_product" ? "active" : ""}">Finished products</button><button data-product-tab="raw_material" class="${ui.productTab === "raw_material" ? "active" : ""}">Raw materials</button><button data-product-tab="categories" class="${ui.productTab === "categories" ? "active" : ""}">Categories</button></div>`;
  if (ui.productTab === "categories") return `<section class="page-section">${pageHeading("Catalog", "Categories", "Organize products for the Admin and Staff workspaces", `<button class="button primary" data-action="add-category">${icon("Plus")} Add category</button>`)}${tabs}<div class="category-grid">${ui.data.categories.length ? ui.data.categories.map(categoryCard).join("") : `<div class="category-empty">${emptyState("Tag", "No categories yet", "Create your first category to start organizing products.")}</div>`}</div></section>`;
  const isFinished = ui.productTab === "finished_product";
  const products = ui.data.products.filter((product) => product.type === ui.productTab && product.name.toLowerCase().includes(ui.productSearch.toLowerCase()));
  const title = isFinished ? "Finished products" : "Raw materials";
  const description = isFinished ? "Manage POS sales items and the ingredient recipe for each serving" : "Manage stocked ingredients, units, and low-stock thresholds";
  const recipeSummary = (product: Product): string => product.recipe.length ? product.recipe.map((item) => { const ingredient = ui.data.products.find((candidate) => candidate.id === item.ingredientId); return `${number.format(item.quantity)} ${ingredient?.unit ?? ""} ${ingredient?.name ?? "Missing ingredient"}`; }).join(", ") : "Recipe not configured";
  return `<section class="page-section">${pageHeading("Catalog", title, description, `<button class="button primary" data-action="add-product">${icon("Plus")} Add ${isFinished ? "sales item" : "raw material"}</button>`)}${tabs}<div class="filter-bar"><label class="search-box">${icon("Search")}<input id="product-search" value="${escapeHtml(ui.productSearch)}" placeholder="Search ${isFinished ? "sales items" : "raw materials"}" /></label></div><article class="table-panel"><div class="table-scroll"><table><thead><tr><th>Product</th><th>Category</th>${isFinished ? "<th>Recipe per serving</th><th>Can make</th><th>Unit price</th>" : "<th>On hand</th><th>Low-stock level</th><th>Status</th>"}<th>Actions</th></tr></thead><tbody>${products.length ? products.map((product) => `<tr><td data-label="Product"><div class="product-cell">${productVisual(product)}<strong>${escapeHtml(product.name)}</strong></div></td><td data-label="Category">${escapeHtml(categoryName(product.categoryId))}</td>${isFinished ? `<td data-label="Recipe">${escapeHtml(recipeSummary(product))}</td><td data-label="Can make">${number.format(product.availableStock)} serving${product.availableStock === 1 ? "" : "s"}</td><td data-label="Unit price">${money.format(product.price)}</td>` : `<td data-label="On hand">${number.format(product.currentStock)} ${escapeHtml(product.unit)}</td><td data-label="Low-stock level">${number.format(product.lowStockThreshold)} ${escapeHtml(product.unit)}</td><td data-label="Status">${statusPill(stockStatus(product))}</td>`}<td data-label="Actions"><div class="row-actions"><button class="small-button" data-action="edit-product" data-id="${product.id}">Edit</button><button class="small-button danger" data-action="delete-product" data-id="${product.id}">${icon("Trash2")} Delete</button></div></td></tr>`).join("") : `<tr><td colspan="6">${emptyState(isFinished ? "Coffee" : "Boxes", `No ${title.toLowerCase()}`, `Add the first ${isFinished ? "finished product and its recipe" : "ingredient or packaging material"}.`)}</td></tr>`}</tbody></table></div></article></section>`;
}

function categoryCard(category: Category): string {
  const count = ui.data.products.filter((product) => product.categoryId === category.id).length;
  return `<article class="category-card"><span>${icon("Tag")}</span><div><h3>${escapeHtml(category.name)}</h3><p>${count} product${count === 1 ? "" : "s"}</p></div><div><button data-action="edit-category" data-id="${category.id}">Edit</button><button class="danger-text" data-action="delete-category" data-id="${category.id}">Delete</button></div></article>`;
}

function renderInventory(): string {
  const materials = rawMaterials();
  const movements = ui.data.stockMovements.filter((movement) => materials.some((product) => product.id === movement.productId));
  return `<section class="page-section">${pageHeading("Stock control", "Raw material inventory", "Record supplier deliveries; completed sales deduct recipe ingredients automatically", `<button class="button primary" data-action="add-stock" ${materials.length ? "" : "disabled"}>${icon("Plus")} Add stock</button>`)}<article class="table-panel"><div class="table-scroll"><table><thead><tr><th>Raw material</th><th>Date</th><th>Quantity added</th><th>Current stock</th><th>Note</th><th>Actions</th></tr></thead><tbody>${movements.length ? movements.map((movement) => { const product = materials.find((item) => item.id === movement.productId); return `<tr><td data-label="Raw material"><strong>${escapeHtml(product?.name ?? "Deleted raw material")}</strong></td><td data-label="Date">${formatDate(movement.date)}</td><td data-label="Quantity">+${number.format(movement.quantity)} ${escapeHtml(product?.unit ?? "")}</td><td data-label="Current stock">${product ? `${number.format(product.currentStock)} ${escapeHtml(product.unit)}` : "—"}</td><td data-label="Note">${escapeHtml(movement.note || "—")}</td><td data-label="Actions"><div class="row-actions"><button class="small-button" data-action="edit-stock" data-id="${movement.id}">Edit</button><button class="small-button danger" data-action="delete-stock" data-id="${movement.id}">Delete</button></div></td></tr>`; }).join("") : `<tr><td colspan="6">${emptyState("Truck", "No stock movements", "Add a raw material and record the first delivery.")}</td></tr>`}</tbody></table></div></article></section>`;
}

function renderReports(): string {
  const report = ui.report;
  const summary = report?.summary;
  return `<section class="page-section">${pageHeading("Performance", "Sales report", "Metrics and exports are calculated from completed SQL transactions")}
    <div class="report-toolbar" aria-label="Report date range"><label><span>From</span><input id="report-from" type="date" value="${ui.reportRange.from}" /></label><span aria-hidden="true">to</span><label><span>To</span><input id="report-to" type="date" value="${ui.reportRange.to}" /></label><button class="button primary" data-action="generate-report" ${ui.reportLoading ? "disabled" : ""}>${ui.reportLoading ? icon("LoaderCircle", "spin") : icon("Download")} Generate report</button></div>
    ${ui.reportLoading ? `<div class="route-loading">${icon("LoaderCircle", "spin")}<p>Calculating report…</p></div>` : !report ? emptyState("BarChart3", "Report unavailable", "Choose a valid date range and try again.") : `<div class="metric-grid report-metrics">${metric("Total sales", money.format((summary?.totalSalesCentavos ?? 0) / 100), "Completed revenue", "BarChart3", "accent")}${metric("Transactions", String(summary?.totalTransactions ?? 0), "Completed orders", "CircleCheck", "success")}${metric("Average sale", money.format((summary?.averageSaleCentavos ?? 0) / 100), "Per completed order", "Receipt")}</div><div class="report-grid"><article class="panel report-chart"><div class="panel-heading"><div><p class="eyebrow">Sales over time</p><h3>Daily revenue</h3></div></div>${revenueBars(report.daily)}</article><article class="panel report-ranking"><div class="panel-heading"><div><p class="eyebrow">Product mix</p><h3>Top sellers</h3></div></div>${report.topProducts.length ? `<ol class="rank-list">${report.topProducts.slice(0, 7).map((product, index) => `<li><span>${index + 1}</span><div><strong>${escapeHtml(product.name)}</strong><small>${product.quantity} units sold</small></div><b>${money.format(product.totalCentavos / 100)}</b></li>`).join("")}</ol>` : emptyState("Box", "No completed sales", "Product rankings will appear after the first completed order.")}</article><article class="panel payment-summary"><div class="panel-heading"><div><p class="eyebrow">Payment mix</p><h3>Payment methods</h3></div></div>${report.payments.length ? `<div class="payment-list">${report.payments.map((item) => `<div><span>${escapeHtml(item.method)}<small>${item.transactions} transaction${item.transactions === 1 ? "" : "s"}</small></span><strong>${money.format(item.totalCentavos / 100)}</strong></div>`).join("")}</div>` : emptyState("WalletCards", "No payment activity", "Payment methods will appear after the first completed order.")}</article></div>`}
  </section>`;
}

function revenueBars(days: ReportSummary["daily"]): string {
  if (!days.some((day) => day.totalCentavos > 0)) return emptyState("BarChart3", "No revenue in this range", "Daily revenue will appear after a completed order.");
  const max = Math.max(...days.map((day) => day.totalCentavos), 1);
  return `<div class="bar-chart">${days.map((day) => `<div><span style="height:${Math.max(5, Math.round(day.totalCentavos / max * 100))}%" title="${money.format(day.totalCentavos / 100)}"></span><small>${day.date.slice(5).replace("-", "/")}</small></div>`).join("")}</div>`;
}

function renderSettings(): string {
  const session = ui.session!;
  const nameParts = session.displayName.trim().split(/\s+/);
  const firstName = nameParts.shift() ?? session.displayName;
  const lastName = nameParts.join(" ");
  return `<section class="page-section settings-page">
    <div class="settings-heading"><div><p class="eyebrow">Account</p><h2>Account &amp; Settings</h2><span>Manage your profile and password.</span></div></div>
    <div class="settings-stack">
      <article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">Basic details</p><h3>Personal information</h3><span>Update the name and photo shown across the workspace.</span></div></div><form id="profile-form" class="profile-form" enctype="multipart/form-data"><div class="profile-avatar-upload"><div class="profile-avatar-preview" id="avatar-preview">${avatarMarkup(session, "settings-avatar")}</div><label class="button secondary" for="avatar-input">${icon("Upload")} Change photo</label><input id="avatar-input" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" /><small>JPG, PNG or WebP · max 5 MB</small><label class="remove-avatar"><input name="removeAvatar" type="checkbox" value="true" ${session.avatarUrl ? "" : "disabled"} /> Remove photo</label></div><div class="profile-fields"><label class="field"><span>First name</span><input name="firstName" value="${escapeHtml(firstName)}" maxlength="40" required /></label><label class="field"><span>Last name</span><input name="lastName" value="${escapeHtml(lastName)}" maxlength="40" /></label><label class="field wide"><span>Email address</span><input value="${escapeHtml(session.email)}" readonly /></label><div class="profile-actions wide"><p class="form-message" id="profile-message"></p><button class="button primary profile-save" type="submit">${icon("Check")} Save profile</button></div></div></form></article>
      <article class="settings-card settings-password"><div class="settings-card-heading"><div><p class="eyebrow">Security</p><h3>Password</h3><span>Use a strong password to protect this account.</span></div>${icon("ShieldCheck")}</div>${passwordForm("admin-password-form")}</article>
    </div>
  </section>`;
}

function passwordForm(id: string): string {
  return `<form class="password-form" id="${id}">${passwordField(id, "currentPassword", "Current password", "current-password")}${passwordField(id, "newPassword", "New password", "new-password", "At least 12 characters with uppercase, lowercase, number and symbol.")}${passwordField(id, "confirmPassword", "Confirm new password", "new-password")}<p class="form-message" data-password-message></p><button class="button primary" type="submit">${icon("ShieldCheck")} Update password</button></form>`;
}

function passwordField(formId: string, name: string, label: string, autocomplete: string, help = ""): string {
  const inputId = `${formId}-${name}`;
  return `<label class="field"><span>${label}</span><div class="password-input"><input id="${inputId}" name="${name}" type="password" autocomplete="${autocomplete}" minlength="${name === "currentPassword" ? "1" : "12"}" required /><button type="button" data-password-toggle="${inputId}" aria-label="Show ${label.toLowerCase()}">${icon("Eye")}</button></div>${help ? `<small>${help}</small>` : ""}</label>`;
}

function bindPasswordToggles(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-password-toggle]").forEach((button) => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle ?? "") as HTMLInputElement | null;
    if (!input) return;
    const willShow = input.type === "password";
    input.type = willShow ? "text" : "password";
    const label = button.closest("label")?.querySelector(":scope > span")?.textContent?.toLowerCase() ?? "password";
    button.setAttribute("aria-label", `${willShow ? "Hide" : "Show"} ${label}`);
    button.innerHTML = icon(willShow ? "EyeOff" : "Eye");
    hydrate(button);
  }));
}

function bindAdmin(): void {
  bindCommon();
  document.querySelector("#open-nav")?.addEventListener("click", () => { ui.navOpen = true; renderAdmin(); });
  document.querySelectorAll("#close-nav,#nav-scrim").forEach((element) => element.addEventListener("click", () => { ui.navOpen = false; renderAdmin(); }));
  document.querySelector("#account-button")?.addEventListener("click", () => { closeNotifications(); ui.accountOpen = !ui.accountOpen; document.querySelector("#account-menu")?.classList.toggle("show", ui.accountOpen); });
  bindRouteButtons();
  bindAdminActions();
  bindFilters();
  bindPasswordForm("#admin-password-form");
  bindProfileForm();
}

function bindRouteButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-route]").forEach((button) => button.addEventListener("click", async () => {
    await navigateAdmin(button.dataset.route as AdminRoute);
  }));
}

async function navigateAdmin(route: AdminRoute, replace = false): Promise<void> {
  ui.route = route;
  ui.navOpen = false;
  ui.accountOpen = false;
  syncLocation(replace);
  if (route === "reports" && !ui.report) await loadReport();
  else renderAdmin();
}

function bindAdminActions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-product-tab]").forEach((button) => button.addEventListener("click", () => { ui.productTab = button.dataset.productTab as ProductTab; renderAdmin(); }));
  onAction("add-category", () => openCategoryDialog());
  onAction("edit-category", (button) => openCategoryDialog(button.dataset.id));
  onAction("delete-category", (button) => confirmDelete("Delete category?", "This category will be permanently removed.", async () => { await api.deleteCategory(button.dataset.id!); await completeMutation("Category deleted."); }));
  onAction("add-product", () => openProductDialog());
  onAction("edit-product", (button) => openProductDialog(button.dataset.id));
  onAction("delete-product", (button) => confirmDelete("Delete product?", "Products with sales or stock history are protected from deletion.", async () => { await api.deleteProduct(button.dataset.id!); await completeMutation("Product deleted."); }));
  onAction("add-stock", () => openStockDialog());
  onAction("edit-stock", (button) => openStockDialog(button.dataset.id));
  onAction("delete-stock", (button) => confirmDelete("Delete stock entry?", "The recorded quantity will be removed from current stock.", async () => { await api.deleteStock(button.dataset.id!); await completeMutation("Stock entry deleted."); }));
  onAction("sale-status", (button) => openSaleStatusDialog(button.dataset.id!, button.dataset.status as SaleStatus));
  onAction("generate-report", openReportExportDialog);
  onAction("sales-csv", () => api.downloadReport("csv", ui.reportRange.from, ui.reportRange.to).catch(handleError));
  document.querySelectorAll<HTMLInputElement>("#report-from,#report-to").forEach((input) => input.addEventListener("change", async () => {
    const from = document.querySelector<HTMLInputElement>("#report-from")!.value;
    const to = document.querySelector<HTMLInputElement>("#report-to")!.value;
    if (from > to) { toast("The start date must be on or before the end date.", "error"); return; }
    ui.reportRange = { from, to }; await loadReport();
  }));
}

function bindFilters(): void {
  document.querySelector<HTMLInputElement>("#product-search")?.addEventListener("input", (event) => {
    ui.productSearch = (event.currentTarget as HTMLInputElement).value;
    document.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
      const name = row.querySelector(".product-cell strong")?.textContent?.toLowerCase() ?? "";
      row.hidden = !name.includes(ui.productSearch.toLowerCase());
    });
  });
  const salesSearch = document.querySelector<HTMLInputElement>("#sales-search");
  const salesStatus = document.querySelector<HTMLSelectElement>("#sales-status");
  const apply = (): void => document.querySelectorAll<HTMLTableRowElement>("[data-sale-row]").forEach((row) => {
    row.hidden = !(row.dataset.search ?? "").includes(salesSearch?.value.toLowerCase() ?? "") || (!!salesStatus && salesStatus.value !== "all" && row.dataset.status !== salesStatus.value);
  });
  salesSearch?.addEventListener("input", apply); salesStatus?.addEventListener("change", apply);
}

async function loadReport(): Promise<void> {
  ui.reportLoading = true; renderAdmin();
  try { ui.report = await api.report(ui.reportRange.from, ui.reportRange.to); }
  catch (error) { ui.report = null; toast(errorMessage(error), "error"); }
  finally { ui.reportLoading = false; renderAdmin(); }
}

function renderStaff(): void {
  const session = ui.session!;
  const hideNav = ["cart", "payment", "success"].includes(ui.staffView);
  app.innerHTML = `<main class="staff-app" id="main-content"><header class="staff-topbar"><img src="${logoUrl}" alt="Company logo" /><div><div class="notification-wrap"><button class="notification-button" data-action="notifications" aria-label="Open notifications" aria-expanded="${ui.notificationsOpen}">${icon("Bell")}<b data-notification-count>${ui.unread || ""}</b></button>${ui.notificationsOpen ? renderNotificationPopover() : ""}</div><button class="staff-account" data-staff-view="account">${avatarMarkup(session)}<strong>${escapeHtml(session.displayName)}</strong></button></div></header><section class="staff-stage">${renderStaffView()}</section>${hideNav ? "" : staffBottomNav()}</main>`;
  hydrate(app); bindStaff();
}

function staffBottomNav(): string {
  const item = (view: StaffView, iconName: string, label: string) => `<button data-staff-view="${view}" class="${ui.staffView === view ? "active" : ""}">${icon(iconName)}<span>${label}</span></button>`;
  return `<nav class="staff-nav">${item("dashboard", "LayoutDashboard", "Home")}${item("orders", "Receipt", "Orders")}${item("products", "Coffee", "Products")}${item("inventory", "Box", "Inventory")}${item("account", "UserRound", "Account")}</nav>`;
}

function renderStaffView(): string {
  if (ui.staffView === "dashboard") return renderStaffDashboard();
  if (ui.staffView === "products") return renderStaffProducts();
  if (ui.staffView === "cart") return renderCart();
  if (ui.staffView === "payment") return renderPayment();
  if (ui.staffView === "success") return renderSuccess();
  if (ui.staffView === "orders") return renderStaffOrders();
  if (ui.staffView === "inventory") return renderStaffInventory();
  return renderStaffAccount();
}

function renderStaffDashboard(): string {
  const todaySales = ui.data.sales.filter((sale) => sale.date === manilaDate() && sale.status === "Completed");
  const alerts = rawMaterials().filter((product) => stockStatus(product) !== "Available");
  return `<div class="staff-screen"><div class="staff-heading"><p>${formatDate(manilaDate())}</p><h1>Today’s overview</h1></div><div class="staff-metrics">${metric("Sales today", money.format(todaySales.reduce((sum, sale) => sum + saleTotal(sale), 0)), "Completed revenue", "BarChart3")}${metric("Transactions", String(todaySales.length), "Completed today", "Receipt")}${metric("Low stock", String(alerts.length), "Items need attention", "CircleAlert", alerts.length ? "warning" : "success")}</div><h2 class="section-title">Quick actions</h2><div class="staff-quick"><button data-staff-view="products">${icon("Plus")}<strong>New order</strong></button><button data-staff-view="orders">${icon("Receipt")}<strong>Orders</strong></button><button data-staff-view="inventory">${icon("Box")}<strong>Inventory</strong></button></div>${ui.data.products.length ? "" : `<div class="staff-empty-note">${icon("CircleAlert")}<div><strong>The catalog is empty</strong><p>An administrator must create categories and products before orders can be taken.</p></div></div>`}</div>`;
}

function renderStaffProducts(): string {
  const allProducts = finishedProducts();
  const categories = ui.data.categories.filter((category) => allProducts.some((product) => product.categoryId === category.id));
  const products = allProducts.filter((product) => (ui.posCategory === "all" || product.categoryId === ui.posCategory) && product.name.toLowerCase().includes(ui.posSearch.toLowerCase()));
  const categoryFilters = `<div class="pos-category-filter" role="group" aria-label="Filter menu by category"><button data-pos-category="all" aria-pressed="${ui.posCategory === "all"}" class="${ui.posCategory === "all" ? "active" : ""}">All</button>${categories.map((category) => `<button data-pos-category="${category.id}" aria-pressed="${ui.posCategory === category.id}" class="${ui.posCategory === category.id ? "active" : ""}">${escapeHtml(category.name)}</button>`).join("")}</div>`;
  return `<div class="staff-screen products-screen"><div class="staff-heading row"><div><p>Point of sale</p><h1>New order</h1></div><button class="cart-button" data-staff-view="cart">${icon("ShoppingCart")}<span>${cartCount()}</span></button></div><label class="search-box large">${icon("Search")}<input id="pos-search" value="${escapeHtml(ui.posSearch)}" placeholder="Search finished products" /></label>${categoryFilters}<div class="staff-product-grid">${products.length ? products.map((product) => `<article class="staff-product ${product.availableStock <= 0 ? "sold-out" : ""}">${productVisual(product, true)}<div><h2 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h2><p>${escapeHtml(categoryName(product.categoryId))}</p><strong>${money.format(product.price)}</strong><small>${product.availableStock <= 0 ? "Unavailable — configure recipe or restock" : `${number.format(product.availableStock)} serving${product.availableStock === 1 ? "" : "s"} available`}</small></div><button data-action="add-cart" data-id="${product.id}" ${product.availableStock <= 0 ? "disabled" : ""} aria-label="Add ${escapeHtml(product.name)}">${icon("Plus")}</button></article>`).join("") : emptyState("Coffee", "No menu items found", "Try another category or search term.")}</div></div>`;
}

function renderCart(): string {
  const items = ui.cart.flatMap((item) => { const product = ui.data.products.find((candidate) => candidate.id === item.productId); return product ? [{ ...item, product }] : []; });
  return `<div class="staff-flow"><div class="flow-header"><button data-staff-view="products">${icon("ArrowLeft")}</button><div><p>Current order</p><h1>Review items</h1></div><button data-action="clear-cart" aria-label="Clear cart">${icon("Trash2")}</button></div><div class="cart-lines">${items.length ? items.map((item) => `<article>${productVisual(item.product)}<div><strong>${escapeHtml(item.product.name)}</strong><small>${money.format(item.product.price)} each</small></div><div class="quantity"><button data-action="cart-minus" data-id="${item.product.id}">${icon("Minus")}</button><b>${item.quantity}</b><button data-action="cart-plus" data-id="${item.product.id}">${icon("Plus")}</button></div><strong>${money.format(item.product.price * item.quantity)}</strong></article>`).join("") : emptyState("ShoppingCart", "Your order is empty", "Add products to continue to payment.")}</div><div class="order-total"><span><small>Subtotal</small><strong>${money.format(cartTotal())}</strong></span><span><small>Total</small><strong>${money.format(cartTotal())}</strong></span></div><button class="button primary wide" data-staff-view="payment" ${items.length ? "" : "disabled"}>Proceed to payment</button></div>`;
}

function renderPayment(): string {
  return `<div class="staff-flow payment-flow"><div class="flow-header"><button data-staff-view="cart">${icon("ArrowLeft")}</button><div><p>Checkout</p><h1>Select payment method</h1></div><span></span></div><article class="payment-card"><div class="payment-total"><small>Total amount</small><strong>${money.format(cartTotal())}</strong></div><div class="payment-options">${paymentOption("Cash", cashLogoUrl)}${paymentOption("GCash", gcashLogoUrl)}${paymentOption("Maya", mayaLogoUrl)}</div><div class="payment-actions"><button class="button secondary" data-staff-view="cart">Cancel</button><button class="button primary" data-action="confirm-payment" ${ui.selectedPayment ? "" : "disabled"}>Confirm payment</button></div></article></div>`;
}

function paymentOption(method: PaymentMethod, logo: string): string {
  return `<button data-payment="${method}" class="${ui.selectedPayment === method ? "selected" : ""}"><img src="${logo}" alt="" /><strong>${method}</strong>${ui.selectedPayment === method ? icon("Check") : ""}</button>`;
}

function renderSuccess(): string {
  const sale = ui.completedSale;
  return `<div class="staff-flow success-flow"><div class="success-mark">${icon("Check")}</div><h1>Payment successful</h1><p>The transaction was saved and inventory was updated.</p><article class="receipt-card"><div><span>Transaction</span><strong>${escapeHtml(sale?.receipt ?? "—")}</strong></div><div><span>Date</span><strong>${sale ? formatDate(sale.date) : "—"}</strong></div><div><span>Cashier</span><strong>${escapeHtml(ui.session!.displayName)}</strong></div><div><span>Payment</span><strong>${escapeHtml(sale?.payment ?? "—")}</strong></div><div class="receipt-total"><span>Total amount</span><strong>${money.format(sale ? saleTotal(sale) : 0)}</strong></div></article><div class="success-actions"><button class="button secondary" data-action="print">${icon("Printer")} Print receipt</button><button class="button primary" data-action="new-order">${icon("Plus")} New order</button></div></div>`;
}

function renderStaffOrders(): string {
  return `<div class="staff-screen"><div class="staff-heading"><p>Transactions</p><h1>Orders</h1></div><div class="mobile-order-list">${ui.data.sales.length ? ui.data.sales.map((sale) => `<article><div><strong>${escapeHtml(sale.receipt)}</strong><small>${formatDate(sale.date)} · ${escapeHtml(sale.payment)}</small></div><span>${money.format(saleTotal(sale))}</span>${statusPill(sale.status)}<button data-action="staff-sale-status" data-id="${sale.id}" data-status="${sale.status === "Completed" ? "Cancelled" : "Completed"}">${sale.status === "Completed" ? "Refund" : "Restore"}</button></article>`).join("") : emptyState("Receipt", "No orders", "Completed customer orders will appear here.")}</div></div>`;
}

function renderStaffInventory(): string {
  const materials = rawMaterials();
  return `<div class="staff-screen"><div class="staff-heading"><p>Stock visibility</p><h1>Raw material inventory</h1></div><div class="mobile-inventory">${materials.length ? materials.map((product) => `<article>${productVisual(product)}<div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(categoryName(product.categoryId))}</small></div><b>${number.format(product.currentStock)} ${escapeHtml(product.unit)}</b>${statusPill(stockStatus(product))}</article>`).join("") : emptyState("Box", "No raw materials", "Raw materials added by an administrator will appear here.")}</div></div>`;
}

function renderStaffAccount(): string {
  return `<div class="staff-screen account-screen"><div class="staff-heading"><p>Account</p><h1>Profile & security</h1></div><article class="panel profile-card">${avatarMarkup(ui.session!, "staff-profile-avatar")}<div><h3>${escapeHtml(ui.session!.displayName)}</h3><small>${escapeHtml(ui.session!.email)}</small><b>Staff</b></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Security</p><h3>Change password</h3></div>${icon("ShieldCheck")}</div>${passwordForm("staff-password-form")}</article><button class="button secondary wide" data-action="logout">${icon("LogOut")} Sign out</button></div>`;
}

function bindStaff(): void {
  bindCommon();
  document.querySelectorAll<HTMLButtonElement>("[data-staff-view]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.staffView as StaffView;
    if (view === "payment" && !ui.cart.length) return;
    navigateStaff(view);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-payment]").forEach((button) => button.addEventListener("click", () => { ui.selectedPayment = button.dataset.payment as PaymentMethod; persistPosState(); renderStaff(); }));
  onAction("add-cart", (button) => addToCart(button.dataset.id!));
  onAction("cart-minus", (button) => changeCart(button.dataset.id!, -1));
  onAction("cart-plus", (button) => changeCart(button.dataset.id!, 1));
  onAction("clear-cart", () => { ui.cart = []; ui.selectedPayment = null; persistPosState(); renderStaff(); });
  onAction("confirm-payment", confirmPayment);
  onAction("print", () => window.print());
  onAction("new-order", () => { ui.cart = []; ui.selectedPayment = null; ui.completedSale = null; persistPosState(); navigateStaff("products"); });
  onAction("staff-sale-status", (button) => openSaleStatusDialog(button.dataset.id!, button.dataset.status as SaleStatus));
  document.querySelectorAll<HTMLButtonElement>("[data-pos-category]").forEach((button) => button.addEventListener("click", () => { ui.posCategory = button.dataset.posCategory ?? "all"; renderStaff(); }));
  document.querySelector<HTMLInputElement>("#pos-search")?.addEventListener("input", (event) => { ui.posSearch = (event.currentTarget as HTMLInputElement).value; renderStaff(); document.querySelector<HTMLInputElement>("#pos-search")?.focus(); });
  bindPasswordForm("#staff-password-form");
}

function navigateStaff(view: StaffView, replace = false): void {
  ui.staffView = view;
  persistPosState();
  syncLocation(replace);
  renderStaff();
}

function bindProfileForm(): void {
  const form = document.querySelector<HTMLFormElement>("#profile-form");
  const input = document.querySelector<HTMLInputElement>("#avatar-input");
  let previewUrl: string | null = null;
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setText("#profile-message", "Profile photos must be 5 MB or smaller."); input.value = ""; return; }
    const preview = document.querySelector<HTMLElement>("#avatar-preview");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    if (preview) preview.innerHTML = `<img class="settings-avatar" src="${previewUrl}" alt="Selected profile preview" />`;
    const remove = document.querySelector<HTMLInputElement>('[name="removeAvatar"]');
    if (remove) remove.checked = false;
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const displayName = `${String(data.get("firstName") ?? "").trim()} ${String(data.get("lastName") ?? "").trim()}`.trim();
    data.set("displayName", displayName);
    data.set("removeAvatar", String(data.get("removeAvatar") === "true"));
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    setButtonBusy(submit, true, "Saving"); setText("#profile-message", "");
    try {
      ui.session = await api.updateProfile(data);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      renderAdmin();
      toast("Profile details saved.", "success");
    } catch (error) {
      setText("#profile-message", errorMessage(error));
      setButtonBusy(submit, false, "Save profile", "Check");
    }
  });
}

function bindCommon(): void {
  onAction("logout", logout);
  onAction("notifications", toggleNotifications);
}

function onAction(name: string, handler: (button: HTMLButtonElement) => void | Promise<void>): void {
  document.querySelectorAll<HTMLButtonElement>(`[data-action="${name}"]`).forEach((button) => button.addEventListener("click", () => { Promise.resolve(handler(button)).catch(handleError); }));
}

function addToCart(productId: string): void {
  const product = ui.data.products.find((item) => item.id === productId);
  if (!product || product.type !== "finished_product" || product.availableStock <= 0) return;
  const nextCart = ui.cart.map((entry) => ({ ...entry }));
  const nextItem = nextCart.find((entry) => entry.productId === productId);
  if (nextItem) nextItem.quantity += 1;
  else nextCart.push({ productId, quantity: 1 });
  if (!cartIngredientsAvailable(nextCart)) { toast("There are not enough recipe ingredients for another serving.", "error"); return; }
  ui.cart = nextCart;
  persistPosState();
  renderStaff(); toast(`${product.name} added to the order.`, "success");
}

function changeCart(productId: string, change: number): void {
  const item = ui.cart.find((entry) => entry.productId === productId);
  const product = ui.data.products.find((entry) => entry.id === productId);
  if (!item || !product) return;
  const next = item.quantity + change;
  if (next <= 0) ui.cart = ui.cart.filter((entry) => entry.productId !== productId);
  else {
    const nextCart = ui.cart.map((entry) => entry.productId === productId ? { ...entry, quantity: next } : { ...entry });
    if (cartIngredientsAvailable(nextCart)) ui.cart = nextCart;
    else toast("There are not enough recipe ingredients for another serving.", "error");
  }
  persistPosState();
  renderStaff();
}

function cartCount(): number { return ui.cart.reduce((sum, item) => sum + item.quantity, 0); }
function cartTotal(): number { return ui.cart.reduce((sum, item) => { const product = ui.data.products.find((entry) => entry.id === item.productId); return sum + (product?.price ?? 0) * item.quantity; }, 0); }

function cartIngredientsAvailable(cart: CartItem[]): boolean {
  const required = new Map<string, number>();
  for (const item of cart) {
    const product = ui.data.products.find((candidate) => candidate.id === item.productId);
    if (!product || product.type !== "finished_product" || !product.recipe.length) return false;
    for (const recipe of product.recipe) required.set(recipe.ingredientId, (required.get(recipe.ingredientId) ?? 0) + recipe.quantity * item.quantity);
  }
  return [...required].every(([ingredientId, quantity]) => {
    const ingredient = ui.data.products.find((product) => product.id === ingredientId && product.type === "raw_material");
    return Boolean(ingredient && ingredient.currentStock + Number.EPSILON >= quantity);
  });
}

async function confirmPayment(button: HTMLButtonElement): Promise<void> {
  if (!ui.selectedPayment || !ui.cart.length) return;
  setButtonBusy(button, true, "Saving payment");
  const result = await api.createSale(ui.selectedPayment, ui.cart);
  await refreshAll(false);
  ui.completedSale = ui.data.sales.find((sale) => sale.id === result.id) ?? null;
  persistPosState();
  navigateStaff("success");
}

function openCategoryDialog(id?: string): void {
  const category = ui.data.categories.find((item) => item.id === id);
  openDialog({ title: category ? "Edit category" : "Add category", description: "Categories organize products in the Admin and Staff workspaces.", body: `<label class="field"><span>Category name</span><input name="name" value="${escapeHtml(category?.name ?? "")}" maxlength="50" required autofocus /></label>`, submitLabel: category ? "Save changes" : "Add category", onSubmit: async (form) => { const name = String(new FormData(form).get("name") ?? "").trim(); if (category) await api.updateCategory(category.id, name); else await api.createCategory(name); await completeMutation(category ? "Category updated." : "Category added."); } });
}

function bindImagePreview(): void {
  document.querySelector<HTMLInputElement>("#product-image")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setDialogError("Images must be 5 MB or smaller."); return; }
    const preview = document.querySelector<HTMLElement>("#image-preview");
    if (preview) preview.innerHTML = `<img class="product-photo large" src="${URL.createObjectURL(file)}" alt="Selected product preview" />`;
  });
}

function openSaleStatusDialog(id: string, status: SaleStatus): void {
  const sale = ui.data.sales.find((item) => item.id === id);
  if (!sale) return;
  const cancelling = status === "Cancelled";
  confirmDelete(cancelling ? "Cancel and refund order?" : "Restore order?", cancelling ? `${sale.receipt} will be cancelled and its consumed raw materials returned to inventory.` : `${sale.receipt} will be completed again and its original recipe quantities deducted from inventory.`, async () => { await api.updateSaleStatus(id, status); await completeMutation(cancelling ? "Order refunded and raw material stock restored." : "Order restored and ingredients deducted."); });
}

function openReportExportDialog(): void {
  openDialog({ title: "Generate sales report", description: `${formatDate(ui.reportRange.from)} to ${formatDate(ui.reportRange.to)}`, body: `<div class="export-options"><button type="button" data-format="pdf">${icon("FileText")}<span><strong>PDF report</strong><small>Printable metrics, rankings, payments and transactions</small></span></button><button type="button" data-format="csv">${icon("Download")}<span><strong>CSV export</strong><small>Spreadsheet-ready transaction and line-item details</small></span></button></div>`, submitLabel: "Close", hideSubmit: true, onOpen: () => { document.querySelectorAll<HTMLButtonElement>("[data-format]").forEach((button) => button.addEventListener("click", async () => { setButtonBusy(button, true, `Creating ${button.dataset.format?.toUpperCase()}`); try { await api.downloadReport(button.dataset.format as "pdf" | "csv", ui.reportRange.from, ui.reportRange.to); toast("Report generated.", "success"); closeDialog(); } catch (error) { setDialogError(errorMessage(error)); setButtonBusy(button, false, button.dataset.format === "pdf" ? "PDF report" : "CSV export"); } })); }, onSubmit: async () => undefined });
}

function renderNotificationPopover(): string {
  const unreadLabel = `${ui.unread} unread notification${ui.unread === 1 ? "" : "s"}`;
  const items = ui.notifications.length
    ? ui.notifications.map((item) => `<button type="button" data-action="open-notification" data-notification-id="${escapeHtml(item.id)}" class="notification-popover-item ${item.isRead ? "" : "unread"}"><i class="${item.severity}">${icon(item.severity === "danger" ? "CircleAlert" : "Bell")}</i><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)}</small><time>${escapeHtml(item.createdAt.replace("T", " ").slice(0, 16))}${item.active ? "" : " · Resolved"}</time></span>${item.isRead ? icon("Check") : '<b aria-hidden="true"></b>'}</button>`).join("")
    : `<div class="notification-popover-empty">${icon("Bell")}<strong>No notifications</strong><span>Inventory alerts will appear here.</span></div>`;
  return `<section class="notification-popover" role="dialog" aria-label="Notifications"><header><div><p class="eyebrow">Notifications</p><h2>Notifications</h2><span>${unreadLabel}</span></div><div class="notification-popover-actions"><button type="button" data-action="mark-all-notifications" ${ui.unread ? "" : "disabled"}>${icon("Check")} Mark all read</button><button type="button" data-action="close-notifications" aria-label="Close notifications">${icon("X")}</button></div></header><div class="notification-popover-list">${items}</div><footer><button type="button" data-action="close-notifications">View all notifications</button><button type="button" data-action="mark-all-notifications" ${ui.unread ? "" : "disabled"}>${icon("Check")} Mark all read</button></footer></section>`;
}

function toggleNotifications(): void {
  const wrap = document.querySelector<HTMLElement>(".notification-wrap");
  if (!wrap) return;
  ui.notificationsOpen = !ui.notificationsOpen;
  ui.accountOpen = false;
  document.querySelector("#account-menu")?.classList.remove("show");
  wrap.querySelector<HTMLButtonElement>(".notification-button")?.setAttribute("aria-expanded", String(ui.notificationsOpen));
  wrap.querySelector(".notification-popover")?.remove();
  if (!ui.notificationsOpen) return;
  wrap.insertAdjacentHTML("beforeend", renderNotificationPopover());
  hydrate(wrap);
  bindNotificationPopover(wrap);
}

function closeNotifications(): void {
  ui.notificationsOpen = false;
  document.querySelector(".notification-popover")?.remove();
  document.querySelector<HTMLButtonElement>(".notification-button")?.setAttribute("aria-expanded", "false");
}

function bindNotificationPopover(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action="close-notifications"]').forEach((button) => button.addEventListener("click", closeNotifications));
  root.querySelectorAll<HTMLButtonElement>('[data-action="mark-all-notifications"]').forEach((button) => button.addEventListener("click", () => { void markAllNotifications(); }));
  root.querySelectorAll<HTMLButtonElement>('[data-action="open-notification"]').forEach((button) => button.addEventListener("click", () => { void openNotification(button); }));
}

function refreshNotificationPopover(): void {
  const popover = document.querySelector<HTMLElement>(".notification-popover");
  if (!popover) return;
  popover.outerHTML = renderNotificationPopover();
  const wrap = document.querySelector<HTMLElement>(".notification-wrap");
  if (wrap) { hydrate(wrap); bindNotificationPopover(wrap); }
}

async function markAllNotifications(): Promise<void> {
  if (!ui.unread) return;
  try {
    await api.readAllNotifications();
    const result = await api.notifications();
    ui.notifications = result.notifications;
    ui.unread = result.unread;
    document.querySelectorAll<HTMLElement>("[data-notification-count]").forEach((element) => { element.textContent = ui.unread ? String(ui.unread) : ""; });
    refreshNotificationPopover();
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

async function openNotification(button: HTMLButtonElement): Promise<void> {
  const notificationId = button.dataset.notificationId;
  if (!notificationId) return;
  try {
    await api.readNotification(notificationId);
    closeNotifications();
    await refreshAll(false);
    if (ui.session?.role === "admin") await navigateAdmin("inventory");
    else navigateStaff("inventory");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}


interface DialogOptions {
  title: string;
  description?: string;
  body: string;
  submitLabel: string;
  wide?: boolean;
  destructive?: boolean;
  hideSubmit?: boolean;
  onOpen?: () => void;
  onSubmit: (form: HTMLFormElement) => Promise<void>;
}

function openDialog(options: DialogOptions): void {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${options.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p class="eyebrow">${ui.session?.role === "staff" ? "Staff POS" : "Admin dashboard"}</p><h2 id="modal-title">${escapeHtml(options.title)}</h2>${options.description ? `<span>${escapeHtml(options.description)}</span>` : ""}</div><button class="modal-close" type="button" aria-label="Close">${icon("X")}</button></header><form id="dialog-form" novalidate><div class="modal-body"><p class="form-message" id="dialog-error" role="alert"></p>${options.body}</div><footer><button class="button secondary modal-cancel" type="button">Cancel</button>${options.hideSubmit ? "" : `<button class="button ${options.destructive ? "danger-button" : "primary"}" type="submit">${escapeHtml(options.submitLabel)}</button>`}</footer></form></section></div>`;
  hydrate(modalRoot);
  const close = (): void => closeDialog();
  document.querySelector(".modal-close")?.addEventListener("click", close);
  document.querySelector(".modal-cancel")?.addEventListener("click", close);
  document.querySelector(".modal-backdrop")?.addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) close(); });
  document.querySelector<HTMLFormElement>("#dialog-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
    if (!submit) return;
    setDialogError(""); setButtonBusy(submit, true, "Saving");
    try { await options.onSubmit(form); }
    catch (error) { setDialogError(errorMessage(error)); setButtonBusy(submit, false, options.submitLabel); }
  });
  options.onOpen?.();
  window.setTimeout(() => document.querySelector<HTMLElement>(".modal input:not([type=file]),.modal select,.modal button")?.focus(), 0);
}

function confirmDelete(title: string, description: string, action: () => Promise<void>): void {
  openDialog({ title, description, destructive: true, body: `<div class="confirm-content">${icon("CircleAlert")}<p>Please confirm this database change. It cannot be undone automatically.</p></div>`, submitLabel: "Confirm", onSubmit: async () => action() });
}

function closeDialog(): void { modalRoot.innerHTML = ""; }
function setDialogError(message: string): void { setText("#dialog-error", message); }

async function completeMutation(message: string): Promise<void> {
  closeDialog(); await refreshAll(false); ui.report = null; render(); toast(message, "success");
}

function bindPasswordForm(selector: string): void {
  const form = document.querySelector<HTMLFormElement>(selector);
  if (!form) return;
  bindPasswordToggles(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form);
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const message = form.querySelector<HTMLElement>("[data-password-message]");
    setButtonBusy(submit, true, "Updating");
    if (message) { message.textContent = ""; message.classList.remove("success"); }
    try {
      const result = await api.changePassword(String(data.get("currentPassword") ?? ""), String(data.get("newPassword") ?? ""), String(data.get("confirmPassword") ?? ""));
      form.reset();
      if (message) { message.textContent = result.message; message.classList.add("success"); }
      toast(result.message, "success");
    } catch (error) {
      if (message) message.textContent = errorMessage(error);
    }
    finally { setButtonBusy(submit, false, "Update password", "ShieldCheck"); }
  });
}

function openStockDialog(id?: string): void {
  const movement = ui.data.stockMovements.find((item) => item.id === id);
  const materials = rawMaterials();
  if (!materials.length) { toast("Add a raw material before recording stock.", "info"); return; }
  openDialog({
    title: movement ? "Edit stock entry" : "Add raw material stock",
    description: "Stock changes are recorded transactionally in Supabase.",
    body: `<label class="field"><span>Raw material</span><select name="productId" ${movement ? "disabled" : ""}>${materials.map((product) => `<option value="${product.id}" ${movement?.productId === product.id ? "selected" : ""}>${escapeHtml(product.name)} · ${number.format(product.currentStock)} ${escapeHtml(product.unit)}</option>`).join("")}</select></label><div class="form-grid"><label class="field"><span>Quantity added</span><input name="quantity" type="number" min="0.001" step="0.001" value="${movement?.quantity ?? ""}" required /></label><label class="field"><span>Date</span><input name="date" type="date" value="${movement?.date ?? manilaDate()}" required /></label><label class="field wide"><span>Note</span><input name="note" maxlength="160" value="${escapeHtml(movement?.note ?? "")}" placeholder="Supplier delivery or reference" /></label></div>`,
    submitLabel: movement ? "Save changes" : "Add stock",
    onSubmit: async (form) => {
      const data = new FormData(form);
      const body = { productId: String(data.get("productId") ?? movement?.productId), quantity: Number(data.get("quantity")), date: String(data.get("date")), note: String(data.get("note") ?? "") };
      if (movement) await api.updateStock(movement.id, body); else await api.createStock(body);
      await completeMutation(movement ? "Stock entry updated." : "Stock added.");
    },
  });
}

function openProductDialog(id?: string, typeOverride?: Product["type"]): void {
  if (!ui.data.categories.length) { toast("Create a category before adding a product.", "info"); ui.productTab = "categories"; renderAdmin(); return; }
  const product = ui.data.products.find((item) => item.id === id);
  const type = typeOverride ?? product?.type ?? (ui.productTab === "raw_material" ? "raw_material" : "finished_product");
  const isFinished = type === "finished_product";
  const excludedIngredientId = product?.type === "raw_material" && isFinished ? product.id : undefined;
  const availableIngredients = rawMaterials().filter((material) => material.id !== excludedIngredientId);
  const recipeRows = product?.recipe ?? [];
  const recipeBody = recipeRows.map((recipe) => recipeIngredientRow(recipe.ingredientId, recipe.quantity, excludedIngredientId)).join("");
  const typeFields = isFinished
    ? `<input name="unit" type="hidden" value="serving" /><input name="currentStock" type="hidden" value="0" /><input name="lowStockThreshold" type="hidden" value="0" /><label class="field"><span>Unit price (PHP)</span><input name="price" type="number" min="0" step="0.01" value="${product?.price ?? 0}" required /></label><fieldset class="recipe-editor wide"><legend>Recipe for one serving</legend><p>${availableIngredients.length ? "Quantities use each raw material's inventory unit. Leave empty to keep this item unavailable in POS." : "Add raw materials first to configure a recipe. You can still save the product details and photo now."}</p><div id="recipe-rows">${recipeBody}</div><button class="small-button" id="add-recipe-row" type="button" ${availableIngredients.length ? "" : "disabled"}>${icon("Plus")} Add ingredient</button></fieldset>`
    : `<label class="field"><span>Inventory unit</span><input name="unit" value="${escapeHtml(product?.unit ?? "mL")}" maxlength="12" placeholder="mL, g, pcs" required /></label>${product ? `<input name="currentStock" type="hidden" value="0" /><div class="field wide stock-readonly"><span>Current stock</span><strong>${number.format(product.currentStock)} ${escapeHtml(product.unit)}</strong><small>Use Add stock in Inventory to change the on-hand quantity.</small></div>` : `<label class="field"><span>Opening stock</span><input name="currentStock" type="number" min="0" step="0.001" value="0" required /></label>`}<label class="field"><span>Low-stock threshold</span><input name="lowStockThreshold" type="number" min="0" step="0.001" value="${product?.lowStockThreshold ?? 10}" required /></label><input name="price" type="hidden" value="0" />`;
  openDialog({
    title: product ? `Edit ${isFinished ? "finished product" : "raw material"}` : `Add ${isFinished ? "finished product" : "raw material"}`,
    description: isFinished ? "Set the sales price and ingredient quantity required for one serving." : "Stock is maintained in this unit and replenished through inventory movements.",
    wide: true,
    body: `<div class="product-form-grid"><label class="image-upload"><input id="product-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span id="image-preview">${product ? productVisual(product, true) : icon("PackagePlus")}</span><strong>${product?.imageUrl ? "Replace photo" : "Upload photo"}</strong><small>JPEG, PNG or WebP · maximum 5 MB</small></label><div class="form-grid"><input name="recipe" type="hidden" value="[]" /><label class="field"><span>Type</span><select id="product-type-selector" name="productType"><option value="finished_product" ${isFinished ? "selected" : ""}>Finished product / sales item</option><option value="raw_material" ${isFinished ? "" : "selected"}>Raw material / ingredient</option></select></label><label class="field"><span>Category</span><select name="categoryId">${ui.data.categories.map((category) => `<option value="${category.id}" ${category.id === product?.categoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></label><label class="field wide"><span>${isFinished ? "Finished product" : "Raw material"} name</span><input name="name" value="${escapeHtml(product?.name ?? "")}" maxlength="80" required /></label>${typeFields}${product?.imageUrl ? `<label class="check-field wide"><input name="removeImage" type="checkbox" value="true" /> Remove current photo</label>` : ""}</div></div>`,
    submitLabel: product ? "Save changes" : `Add ${isFinished ? "sales item" : "raw material"}`,
    onOpen: () => {
      bindImagePreview();
      if (isFinished) bindRecipeEditor(excludedIngredientId);
      document.querySelector<HTMLSelectElement>("#product-type-selector")?.addEventListener("change", (event) => {
        const nextType = (event.currentTarget as HTMLSelectElement).value as Product["type"];
        closeDialog();
        openProductDialog(id, nextType);
      });
    },
    onSubmit: async (form) => {
      const data = new FormData(form);
      if (isFinished) data.set("recipe", JSON.stringify(readRecipeEditor()));
      ["currentStock", "lowStockThreshold", "price"].forEach((name) => data.set(name, String(Number(data.get(name)))));
      data.set("removeImage", String(data.get("removeImage") === "true"));
      if (product) await api.updateProduct(product.id, data); else await api.createProduct(data);
      await completeMutation(product ? "Product updated." : "Product added.");
    },
  });
}

function recipeIngredientRow(ingredientId: string, quantity: number, excludedIngredientId?: string): string {
  const materials = rawMaterials().filter((material) => material.id !== excludedIngredientId);
  const selected = materials.find((material) => material.id === ingredientId) ?? materials[0];
  return `<div class="recipe-row"><label class="field"><span>Ingredient</span><select data-recipe-ingredient>${materials.map((material) => `<option value="${material.id}" ${material.id === selected?.id ? "selected" : ""}>${escapeHtml(material.name)}</option>`).join("")}</select></label><label class="field recipe-quantity"><span>Quantity</span><span><input data-recipe-quantity type="number" min="0.001" step="0.001" value="${quantity}" required /><b data-recipe-unit>${escapeHtml(selected?.unit ?? "")}</b></span></label><button type="button" data-remove-recipe aria-label="Remove ingredient">${icon("Trash2")}</button></div>`;
}

function bindRecipeEditor(excludedIngredientId?: string): void {
  const rows = document.querySelector<HTMLElement>("#recipe-rows");
  const bindRow = (row: HTMLElement): void => {
    const select = row.querySelector<HTMLSelectElement>("[data-recipe-ingredient]");
    select?.addEventListener("change", () => {
      const material = rawMaterials().find((item) => item.id === select.value);
      const unit = row.querySelector<HTMLElement>("[data-recipe-unit]");
      if (unit) unit.textContent = material?.unit ?? "";
    });
    row.querySelector<HTMLButtonElement>("[data-remove-recipe]")?.addEventListener("click", () => {
      row.remove();
    });
  };
  rows?.querySelectorAll<HTMLElement>(".recipe-row").forEach(bindRow);
  document.querySelector<HTMLButtonElement>("#add-recipe-row")?.addEventListener("click", () => {
    const material = rawMaterials().find((item) => item.id !== excludedIngredientId);
    rows?.insertAdjacentHTML("beforeend", recipeIngredientRow(material?.id ?? "", 1, excludedIngredientId));
    const row = rows?.lastElementChild;
    if (row instanceof HTMLElement) { hydrate(row); bindRow(row); }
  });
}

function readRecipeEditor(): Array<{ ingredientId: string; quantity: number }> {
  return [...document.querySelectorAll<HTMLElement>(".recipe-row")].map((row) => ({
    ingredientId: row.querySelector<HTMLSelectElement>("[data-recipe-ingredient]")?.value ?? "",
    quantity: Number(row.querySelector<HTMLInputElement>("[data-recipe-quantity]")?.value),
  }));
}

async function logout(): Promise<void> {
  try { await api.logout(); } catch { /* Clear the local UI even if the session already expired. */ }
  window.clearInterval(notificationTimer); ui.session = null; ui.roleChoice = null; ui.data = emptyData(); ui.cart = []; ui.selectedPayment = null; ui.completedSale = null; ui.report = null; ui.posSearch = ""; ui.posCategory = "all";
  window.sessionStorage.removeItem(posStateKey); closeDialog(); syncLocation(true); render();
}

function statusPill(status: string): string {
  const tone = status === "Completed" || status === "Available" ? "success" : status === "Cancelled" || status === "Out of stock" ? "danger" : "warning";
  return `<span class="status-pill ${tone}"><i></i>${escapeHtml(status)}</span>`;
}

function emptyState(iconName: string, title: string, copy: string): string {
  return `<div class="empty-state">${icon(iconName)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div>`;
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean, label: string, iconName = ""): void {
  button.disabled = busy;
  button.innerHTML = busy ? `${icon("LoaderCircle", "spin")} ${escapeHtml(label)}` : `${iconName ? icon(iconName) : ""}${escapeHtml(label)}`;
  hydrate(button);
}

function setText(selector: string, message: string, className = ""): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) { element.textContent = message; element.classList.toggle("success", className === "success"); }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Something went wrong."; }
function handleError(error: unknown): void { toast(errorMessage(error), "error"); }

function toast(message: string, kind: ToastKind): void {
  const item = document.createElement("div"); item.className = `toast ${kind}`; item.setAttribute("role", kind === "error" ? "alert" : "status");
  item.innerHTML = `${icon(kind === "success" ? "CircleCheck" : kind === "error" ? "CircleAlert" : "Bell")}<span>${escapeHtml(message)}</span><button aria-label="Dismiss">${icon("X")}</button>`;
  item.querySelector("button")?.addEventListener("click", () => item.remove()); toastRegion.append(item); hydrate(item);
  window.setTimeout(() => item.remove(), 4500);
}

window.addEventListener("popstate", () => {
  restoreLocationState();
  syncLocation(true);
  if (ui.session?.role === "admin" && ui.route === "reports" && !ui.report) void loadReport();
  else render();
});

void bootstrap();
