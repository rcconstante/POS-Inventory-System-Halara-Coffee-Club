// Demo-only in-memory replacement for src/api.ts. No network, no Supabase.
// State is kept in localStorage so the tablet page and the web page share it,
// and a `storage` event plays the role of Supabase Realtime.
/* eslint-disable */
type Any = any;

const DB_KEY = "halara-demo-db";
const SESSION_KEY = "halara-demo-session";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function manilaDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function isoAt(date: string, hour: number, minute: number): string {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`).toISOString();
}
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function art(emoji: string, a: string, b: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'><defs><radialGradient id='g' cx='35%' cy='30%' r='85%'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></radialGradient></defs><rect width='240' height='240' fill='url(#g)'/><circle cx='120' cy='132' r='78' fill='rgba(255,255,255,.18)'/><text x='120' y='158' font-size='104' text-anchor='middle' font-family='Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif'>${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const ADMIN = { id: "u-admin", email: "admin@halara.test", displayName: "Andrea Reyes", role: "admin" };
const STAFF = { id: "u-staff", email: "staff@halara.test", displayName: "Miguel Santos", role: "staff" };

function seed(): Any {
  const categories = ["Espresso Based", "Not Coffee", "Tea Refreshers and Soda", "Sandwiches", "Pastries", "Pasta", "Add-ons", "Ingredients", "Packaging"].map((name, i) => ({ id: `c${i}`, name }));
  const cat = (n: string) => categories.find((c) => c.name === n)!.id;
  const raw = (id: string, name: string, unit: string, stock: number, thr: number, cost: number, category = "Ingredients", emoji = "📦", a = "#f3e1c7", b = "#c99a6a") => ({ id, name, category_id: cat(category), product_type: "raw_material", tracks_inventory: true, unit, current_stock: stock, low_stock_threshold: thr, avg: cost, cost_initialized: cost > 0, price: 0, image: art(emoji, a, b) });
  const products: Any[] = [
    raw("r-beans", "Espresso Beans", "g", 2350, 500, 1.2, "Ingredients", "🫘", "#e9d2b4", "#7a4a2a"),
    raw("r-milk", "Fresh Milk", "mL", 6200, 2000, 0.09, "Ingredients", "🥛", "#ffffff", "#cfe0ee"),
    raw("r-oat", "Oatside Milk", "mL", 900, 1000, 0.18, "Ingredients", "🌾", "#fff3d6", "#d9b46a"),
    raw("r-caramel", "Caramel Syrup", "mL", 760, 300, 0.45, "Ingredients", "🍯", "#ffe2b0", "#c8792b"),
    raw("r-vanilla", "Vanilla Syrup", "mL", 640, 300, 0.42, "Ingredients", "🌼", "#fff7d1", "#e4c35c"),
    raw("r-matcha", "Matcha Powder", "g", 165, 200, 2.8, "Ingredients", "🍵", "#e5f3d3", "#6f9b3c"),
    raw("r-choco", "Chocolate Sauce", "mL", 1180, 400, 0.38, "Ingredients", "🍫", "#e9cdb8", "#5b2f1c"),
    raw("r-lemon", "Lemon Tea Concentrate", "mL", 2100, 600, 0.12, "Ingredients", "🍋", "#fff7b8", "#e2c52f"),
    raw("r-soda", "Soda Water", "mL", 3300, 1000, 0.05, "Ingredients", "🫧", "#e6f6ff", "#7fc3e8"),
    raw("r-bread", "Sandwich Bread", "pcs", 38, 20, 6.5, "Ingredients", "🍞", "#ffe9c7", "#c98b47"),
    raw("r-ham", "Ham Slices", "pcs", 0, 10, 8, "Ingredients", "🥓", "#ffd9d2", "#c25b4a"),
    raw("r-cheese", "Cheese Slices", "pcs", 54, 15, 5.5, "Ingredients", "🧀", "#fff1b8", "#e5a823"),
    raw("r-cup", "16oz Cups", "pcs", 310, 100, 4.5, "Packaging", "🥤", "#f4ece4", "#a9907a"),
  ];
  const fin = (id: string, name: string, category: string, price: number, emoji: string, a: string, b: string, recipe: Array<[string, number]>) => {
    const tracked = !["Pastries", "Pasta"].includes(category);
    products.push({ id, name, category_id: cat(category), product_type: "finished_product", tracks_inventory: tracked, unit: "serving", current_stock: 0, low_stock_threshold: 0, avg: 0, cost_initialized: false, price, image: art(emoji, a, b), recipe: tracked ? recipe : [] });
  };
  fin("p-americano", "Americano", "Espresso Based", 120, "☕", "#f1dcc4", "#8b5a35", [["r-beans", 18], ["r-cup", 1]]);
  fin("p-latte", "Café Latte", "Espresso Based", 150, "☕", "#f7e7d3", "#b07a4f", [["r-beans", 18], ["r-milk", 200], ["r-cup", 1]]);
  fin("p-caramel", "Caramel Macchiato", "Espresso Based", 170, "🧋", "#ffe6c2", "#c98436", [["r-beans", 18], ["r-milk", 180], ["r-caramel", 30], ["r-cup", 1]]);
  fin("p-spanish", "Spanish Latte", "Espresso Based", 165, "☕", "#fbe9d6", "#a86b3d", [["r-beans", 18], ["r-milk", 200], ["r-vanilla", 20], ["r-cup", 1]]);
  fin("p-oat", "Oat Latte", "Espresso Based", 175, "🥛", "#fff1d6", "#c79a52", [["r-beans", 18], ["r-oat", 200], ["r-cup", 1]]);
  fin("p-matcha", "Matcha Latte", "Not Coffee", 165, "🍵", "#e8f5d8", "#5f8f35", [["r-matcha", 15], ["r-milk", 200], ["r-cup", 1]]);
  fin("p-choco", "Iced Chocolate", "Not Coffee", 140, "🍫", "#f0d6c4", "#6b3a22", [["r-choco", 40], ["r-milk", 200], ["r-cup", 1]]);
  fin("p-lemontea", "Lemon Iced Tea", "Tea Refreshers and Soda", 110, "🍋", "#fff8c4", "#d8b628", [["r-lemon", 120], ["r-cup", 1]]);
  fin("p-soda", "Italian Soda", "Tea Refreshers and Soda", 120, "🥤", "#ffe0ea", "#d2577d", [["r-soda", 250], ["r-vanilla", 20], ["r-cup", 1]]);
  fin("p-hamcheese", "Ham & Cheese Sandwich", "Sandwiches", 180, "🥪", "#ffe7c9", "#c4803d", [["r-bread", 2], ["r-ham", 2], ["r-cheese", 1]]);
  fin("p-grilled", "Grilled Cheese", "Sandwiches", 150, "🧀", "#fff0bf", "#d99a26", [["r-bread", 2], ["r-cheese", 2]]);
  fin("p-croissant", "Butter Croissant", "Pastries", 95, "🥐", "#ffeccd", "#cf8d3e", []);
  fin("p-muffin", "Blueberry Muffin", "Pastries", 85, "🧁", "#e8e4ff", "#6a5fc4", []);
  fin("p-carbonara", "Creamy Carbonara", "Pasta", 220, "🍝", "#fff3d1", "#d6a243", []);
  fin("p-shot", "Extra Espresso Shot", "Add-ons", 40, "➕", "#f1dcc4", "#6d4426", [["r-beans", 18]]);

  const db: Any = { categories, products, movements: [], sales: [], items: [], usage: [], shifts: [], cashMovements: [], notifications: [], reads: [], qr: { GCash: "/gcash-qr.png", Maya: null }, receiptSeq: 0 };

  // Deliveries over the week.
  const delivery = (pid: string, qty: number, cost: number, day: number, note: string) => db.movements.push({ id: uid("m"), product_id: pid, quantity: qty, movement_date: manilaDate(-day), note, total_cost: cost, unit_cost: cost / qty, created_at: isoAt(manilaDate(-day), 8, 10) });
  delivery("r-beans", 2000, 2400, 6, "Weekly roaster delivery");
  delivery("r-milk", 6000, 540, 5, "Dairy supplier");
  delivery("r-cup", 250, 1125, 4, "Packaging restock");
  delivery("r-caramel", 750, 337.5, 3, "Syrup supplier");
  delivery("r-bread", 30, 195, 2, "Bakery partner");
  delivery("r-milk", 4000, 360, 1, "Dairy supplier");

  // Historical sales: closed shifts per day.
  const menu = products.filter((p) => p.product_type === "finished_product" && p.id !== "p-hamcheese");
  let rnd = 7;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
  for (let day = 6; day >= 1; day--) {
    const date = manilaDate(-day);
    const shiftId = uid("s");
    const shift: Any = { id: shiftId, opened_by: STAFF.id, cashier_name: STAFF.displayName, status: "Closed", opening: 1000, opened_at: isoAt(date, 7, 2), closed_at: isoAt(date, 20, 15), counted: null, note: "End of day count" };
    db.shifts.push(shift);
    const count = 7 + Math.floor(rand() * 7);
    for (let n = 0; n < count; n++) {
      const lines: Any[] = [];
      const kinds = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < kinds; k++) {
        const p = menu[Math.floor(rand() * menu.length)];
        const ex = lines.find((l) => l.product_id === p.id);
        if (ex) ex.quantity++; else lines.push({ product_id: p.id, quantity: 1 + (rand() < 0.2 ? 1 : 0) });
      }
      const r = rand();
      const payment = r < 0.58 ? "Cash" : r < 0.85 ? "GCash" : "Maya";
      const minute = 7 * 60 + 30 + Math.floor((n + rand()) * (12 * 60) / count);
      recordSale(db, { payment, lines, date, createdAt: isoAt(date, Math.floor(minute / 60), minute % 60), shiftId, status: day === 3 && n === 2 ? "Cancelled" : "Completed", applyStock: false });
    }
    const cash = cashSales(db, shiftId);
    shift.counted = 1000 + cash + (day === 4 ? -20 : 0);
    if (day === 4) shift.note = "Short ₱20 — coins miscounted at handover";
    if (day === 2) { db.cashMovements.push({ id: uid("cm"), shift_id: shiftId, movement_type: "Cash Out", amount: 150, reason: "Bought ice from market", created_at: isoAt(date, 13, 5) }); shift.counted -= 150; }
  }
  const note = (pid: string, type: string, day: number, active: boolean, hour = 15) => {
    const p = db.products.find((x: Any) => x.id === pid);
    db.notifications.push({ id: uid("n"), type, severity: type === "out_of_stock" ? "danger" : "warning", title: type === "out_of_stock" ? `${p.name} is out of stock` : `${p.name} is running low`, message: type === "out_of_stock" ? `0 ${p.unit} remaining. Restock to keep recipes available.` : `${p.current_stock} ${p.unit} left (alert level ${p.low_stock_threshold} ${p.unit}).`, product_id: pid, created_at: isoAt(manilaDate(-day), hour, 20), resolved_at: active ? null : isoAt(manilaDate(-day + 1), 9, 0), active });
  };
  note("r-caramel", "low_stock", 4, false, 11);
  note("r-oat", "low_stock", 1, true, 16);
  note("r-matcha", "low_stock", 1, true, 18);
  note("r-ham", "out_of_stock", 0, true, 8);
  return db;
}

function cashSales(db: Any, shiftId: string): number {
  return db.sales.filter((s: Any) => s.cash_shift_id === shiftId && s.status === "Completed" && s.payment_method === "Cash").reduce((t: number, s: Any) => t + s.total, 0);
}

function recipeOf(db: Any, pid: string): Array<{ ingredient_id: string; quantity: number }> {
  const p = db.products.find((x: Any) => x.id === pid);
  return (p?.recipe ?? []).map(([ingredient_id, quantity]: [string, number]) => ({ ingredient_id, quantity }));
}

function recordSale(db: Any, o: Any): Any {
  db.receiptSeq += 1;
  const id = uid("sale");
  const receipt = `HCC-${o.date.replaceAll("-", "")}-${String(db.receiptSeq).padStart(4, "0")}`;
  let total = 0;
  for (const line of o.lines) {
    const p = db.products.find((x: Any) => x.id === line.product_id);
    total += p.price * line.quantity;
    db.items.push({ sale_id: id, product_id: p.id, product_name: p.name, quantity: line.quantity, unit_price: p.price, tracked: p.tracks_inventory });
    if (p.tracks_inventory) for (const r of recipeOf(db, p.id)) {
      const ing = db.products.find((x: Any) => x.id === r.ingredient_id);
      db.usage.push({ sale_id: id, ingredient_id: ing.id, ingredient_name: ing.name, quantity: r.quantity * line.quantity, unit: ing.unit });
      if (o.applyStock) ing.current_stock = Math.round((ing.current_stock - r.quantity * line.quantity) * 1000) / 1000;
    }
  }
  const sale = { id, receipt, business_date: o.date, payment_method: o.payment, status: o.status ?? "Completed", total, created_at: o.createdAt, created_by: STAFF.id, cashier_name: STAFF.displayName, cash_shift_id: o.shiftId, cash_received: o.payment === "Cash" ? (o.cashReceived ?? total) : null, change: o.payment === "Cash" ? (o.cashReceived ?? total) - total : null, client_reference: o.clientReference ?? null };
  db.sales.push(sale);
  return sale;
}

function load(): Any {
  try { const raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw); } catch { /* reseed */ }
  const db = seed(); save(db); return db;
}
function save(db: Any): void { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function mutate<T>(fn: (db: Any) => T): T { const db = load(); const out = fn(db); save(db); listeners.forEach((l) => l()); return out; }

function sessionUser(): Any {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}

function checkAlerts(db: Any, pid: string): void {
  const p = db.products.find((x: Any) => x.id === pid);
  if (!p || p.product_type !== "raw_material") return;
  const active = db.notifications.find((n: Any) => n.product_id === pid && n.active);
  const status = p.current_stock <= 0 ? "out_of_stock" : p.current_stock <= p.low_stock_threshold ? "low_stock" : null;
  if (!status) { if (active) { active.active = false; active.resolved_at = new Date().toISOString(); } return; }
  if (active && active.type === status) return;
  if (active) { active.active = false; active.resolved_at = new Date().toISOString(); }
  db.notifications.push({ id: uid("n"), type: status, severity: status === "out_of_stock" ? "danger" : "warning", title: status === "out_of_stock" ? `${p.name} is out of stock` : `${p.name} is running low`, message: status === "out_of_stock" ? `0 ${p.unit} remaining. Restock to keep recipes available.` : `${p.current_stock} ${p.unit} left (alert level ${p.low_stock_threshold} ${p.unit}).`, product_id: pid, created_at: new Date().toISOString(), resolved_at: null, active: true });
}

function shiftSummary(db: Any, s: Any): Any {
  const sales = db.sales.filter((x: Any) => x.cash_shift_id === s.id && x.status === "Completed");
  const cash = sales.filter((x: Any) => x.payment_method === "Cash").reduce((t: number, x: Any) => t + x.total, 0);
  const digital = sales.filter((x: Any) => x.payment_method !== "Cash").reduce((t: number, x: Any) => t + x.total, 0);
  const moves = db.cashMovements.filter((m: Any) => m.shift_id === s.id);
  const cin = moves.filter((m: Any) => m.movement_type === "Cash In").reduce((t: number, m: Any) => t + m.amount, 0);
  const cout = moves.filter((m: Any) => m.movement_type === "Cash Out").reduce((t: number, m: Any) => t + m.amount, 0);
  const expected = s.opening + cash + cin - cout;
  return { id: s.id, openedBy: s.opened_by, cashierName: s.cashier_name, status: s.status, openingBalance: s.opening, openedAt: s.opened_at, closedAt: s.closed_at, countedCash: s.counted, expectedCash: expected, variance: s.counted === null ? null : Math.round((s.counted - expected) * 100) / 100, closingNote: s.note ?? "", cashSales: cash, digitalSales: digital, cashIn: cin, cashOut: cout };
}

function appData(): Any {
  const db = load();
  const products = db.products.map((p: Any) => ({ id: p.id, name: p.name, categoryId: p.category_id, type: p.product_type, tracksInventory: p.tracks_inventory, unit: p.unit, currentStock: p.current_stock, availableStock: 0, lowStockThreshold: p.low_stock_threshold, averageUnitCost: p.avg, costInitialized: p.cost_initialized, price: p.price, imageUrl: p.image, recipe: recipeOf(db, p.id).map((r) => ({ ingredientId: r.ingredient_id, quantity: r.quantity })) }))
    .sort((a: Any, b: Any) => a.name.localeCompare(b.name));
  const byId = new Map(products.map((p: Any) => [p.id, p]));
  for (const p of products) p.availableStock = p.type === "raw_material" ? Math.floor(p.currentStock) : !p.tracksInventory ? Number.MAX_SAFE_INTEGER : p.recipe.length ? Math.max(0, Math.min(...p.recipe.map((r: Any) => { const i: Any = byId.get(r.ingredientId); return i && r.quantity > 0 ? Math.floor(i.currentStock / r.quantity) : 0; }))) : 0;
  const sales = [...db.sales].sort((a: Any, b: Any) => b.created_at.localeCompare(a.created_at)).map((s: Any) => ({ id: s.id, receipt: s.receipt, date: s.business_date, payment: s.payment_method, status: s.status, total: s.total, items: db.items.filter((i: Any) => i.sale_id === s.id).map((i: Any) => ({ productId: i.product_id, name: i.product_name, quantity: i.quantity, unitPrice: i.unit_price })), createdAt: s.created_at, createdBy: s.created_by, cashierName: s.cashier_name, cashShiftId: s.cash_shift_id, cashReceived: s.cash_received, change: s.change }));
  return {
    categories: [...db.categories].sort((a: Any, b: Any) => a.name.localeCompare(b.name)),
    products,
    stockMovements: [...db.movements].sort((a: Any, b: Any) => b.created_at.localeCompare(a.created_at)).map((m: Any) => ({ id: m.id, productId: m.product_id, quantity: m.quantity, date: m.movement_date, note: m.note, totalCost: m.total_cost, unitCost: m.unit_cost })),
    sales,
    cashShifts: [...db.shifts].sort((a: Any, b: Any) => b.opened_at.localeCompare(a.opened_at)).map((s: Any) => shiftSummary(db, s)),
    cashMovements: [...db.cashMovements].sort((a: Any, b: Any) => b.created_at.localeCompare(a.created_at)).map((m: Any) => ({ id: m.id, shiftId: m.shift_id, type: m.movement_type, amount: m.amount, reason: m.reason, createdAt: m.created_at })),
    ingredientUsage: db.usage.map((u: Any) => ({ saleId: u.sale_id, ingredientId: u.ingredient_id, ingredientName: u.ingredient_name, quantity: u.quantity, unit: u.unit })),
  };
}

async function buildReport(from: string, to: string): Promise<Any> {
  if (from > to) throw new Error("Start date must be on or before end date.");
  await wait(350);
  const data = appData();
  const sales = data.sales.filter((s: Any) => s.date >= from && s.date <= to);
  const completed = sales.filter((s: Any) => s.status === "Completed");
  const totalSalesCentavos = completed.reduce((t: number, s: Any) => t + Math.round(s.total * 100), 0);
  const daily = new Map<string, number>(); const prod = new Map<string, Any>(); const pay = new Map<string, Any>();
  for (const s of completed) {
    const c = Math.round(s.total * 100);
    daily.set(s.date, (daily.get(s.date) ?? 0) + c);
    const p = pay.get(s.payment) ?? { transactions: 0, totalCentavos: 0 }; p.transactions++; p.totalCentavos += c; pay.set(s.payment, p);
    for (const i of s.items) { const x = prod.get(i.name) ?? { quantity: 0, totalCentavos: 0 }; x.quantity += i.quantity; x.totalCentavos += Math.round(i.unitPrice * 100) * i.quantity; prod.set(i.name, x); }
  }
  const dates: string[] = []; const cur = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) { dates.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return {
    range: { from, to },
    summary: { totalSalesCentavos, totalTransactions: completed.length, averageSaleCentavos: completed.length ? Math.round(totalSalesCentavos / completed.length) : 0 },
    daily: dates.map((date) => ({ date, totalCentavos: daily.get(date) ?? 0 })),
    topProducts: [...prod.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.quantity - a.quantity),
    payments: [...pay.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.totalCentavos - a.totalCentavos),
    transactions: sales.map((s: Any) => ({ receipt: s.receipt, date: s.date, payment: s.payment, status: s.status, totalCentavos: Math.round(s.total * 100), items: s.items.map((i: Any) => `${i.name} x${i.quantity}`).join("; ") })),
  };
}

async function buildInventoryReport(from: string, to: string): Promise<Any> {
  if (from > to) throw new Error("Start date must be on or before end date.");
  await wait(350);
  const db = load(); const data = appData();
  const materials = data.products.filter((p: Any) => p.type === "raw_material");
  const stock = materials.map((p: Any) => ({ name: p.name, unit: p.unit, quantity: p.currentStock, averageUnitCostCentavos: p.costInitialized ? Math.round(p.averageUnitCost * 100) : null, valueCentavos: p.costInitialized ? Math.round(p.currentStock * p.averageUnitCost * 100) : null, threshold: p.lowStockThreshold, status: p.currentStock <= 0 ? "Out of stock" : p.currentStock <= p.lowStockThreshold ? "Low stock" : "Available" }));
  const ids = new Set(data.sales.filter((s: Any) => s.status === "Completed" && s.date >= from && s.date <= to).map((s: Any) => s.id));
  const usage = new Map<string, Any>();
  data.ingredientUsage.filter((u: Any) => ids.has(u.saleId)).forEach((u: Any) => { const c = usage.get(u.ingredientId) ?? { name: u.ingredientName, quantity: 0, unit: u.unit }; c.quantity += u.quantity; usage.set(u.ingredientId, c); });
  const byId = new Map(materials.map((p: Any) => [p.id, p]));
  return {
    range: { from, to },
    summary: { materialCount: materials.length, valuedMaterials: stock.filter((r: Any) => r.valueCentavos !== null).length, totalValueCentavos: stock.reduce((t: number, r: Any) => t + (r.valueCentavos ?? 0), 0), lowStockCount: stock.filter((r: Any) => r.status !== "Available").length },
    stock,
    movements: data.stockMovements.filter((m: Any) => m.date >= from && m.date <= to).map((m: Any) => ({ date: m.date, name: (byId.get(m.productId) as Any)?.name ?? "Deleted material", quantity: m.quantity, unit: (byId.get(m.productId) as Any)?.unit ?? "", totalCostCentavos: m.totalCost === null ? null : Math.round(m.totalCost * 100), note: m.note })),
    usage: [...usage.values()].sort((a, b) => a.name.localeCompare(b.name)),
    alerts: db.notifications.filter((n: Any) => n.created_at.slice(0, 10) >= from).sort((a: Any, b: Any) => b.created_at.localeCompare(a.created_at)).map((n: Any) => ({ createdAt: n.created_at, resolvedAt: n.resolved_at, name: (byId.get(n.product_id) as Any)?.name ?? "Deleted material", type: n.type, severity: n.severity })),
  };
}

const listeners = new Set<() => void>();
window.addEventListener("storage", (e) => { if (e.key === DB_KEY) listeners.forEach((l) => l()); });

function requireRole(role?: string): Any {
  const u = sessionUser(); if (!u) throw new Error("Not signed in.");
  if (role && u.role !== role) throw new Error("You do not have permission to perform this action.");
  return u;
}

export const api = {
  async paymentQrSettings() { await wait(120); const db = load(); return { GCash: db.qr.GCash, Maya: db.qr.Maya }; },
  async setPaymentQr(method: "GCash" | "Maya", image: string | null) { await wait(300); requireRole("admin"); mutate((db) => { db.qr[method] = image; }); },
  async session() { await wait(150); const u = sessionUser(); if (!u) throw new Error("Not signed in."); return { ...u, avatarUrl: null }; },
  async login(role: string, email: string, _password: string) {
    await wait(650);
    const user = [ADMIN, STAFF].find((u) => u.email === email.trim().toLowerCase());
    if (!user) throw new Error("The email or password is incorrect.");
    if (user.role !== role) throw new Error(`This account does not have ${role} access.`);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return { ...user, avatarUrl: null };
  },
  async logout() { sessionStorage.removeItem(SESSION_KEY); },
  async changePassword() { await wait(500); return { message: "Password changed successfully." }; },
  async updateProfile(data: FormData) { await wait(400); const u = requireRole(); u.displayName = String(data.get("displayName") ?? u.displayName); sessionStorage.setItem(SESSION_KEY, JSON.stringify(u)); return { ...u, avatarUrl: null }; },
  async appData() { await wait(180); return appData(); },
  async createCategory(name: string) { await wait(250); return mutate((db) => { const c = { id: uid("c"), name: name.trim() }; db.categories.push(c); return c; }); },
  async updateCategory(id: string, name: string) { await wait(250); return mutate((db) => { const c = db.categories.find((x: Any) => x.id === id); c.name = name.trim(); return c; }); },
  async deleteCategory(id: string) { await wait(250); mutate((db) => { if (db.products.some((p: Any) => p.category_id === id)) throw new Error("Categories that contain products cannot be deleted."); db.categories = db.categories.filter((c: Any) => c.id !== id); }); },
  async createProduct(form: FormData) { await wait(400); return saveProduct(uid("p"), form); },
  async updateProduct(id: string, form: FormData) { await wait(400); return saveProduct(id, form); },
  async deleteProduct(id: string) { await wait(300); mutate((db) => { if (db.items.some((i: Any) => i.product_id === id) || db.movements.some((m: Any) => m.product_id === id)) throw new Error("Products with sales or stock history are protected from deletion."); db.products = db.products.filter((p: Any) => p.id !== id); }); },
  async createStock(body: Any) {
    await wait(400);
    return mutate((db) => {
      const p = db.products.find((x: Any) => x.id === body.productId);
      if (!(body.quantity > 0)) throw new Error("Quantity must be greater than zero.");
      if (!(body.totalCost > 0)) throw new Error("Enter the total purchase cost.");
      const valued = p.cost_initialized ? p.current_stock * p.avg : 0;
      p.avg = (valued + body.totalCost) / ((p.cost_initialized ? p.current_stock : 0) + body.quantity);
      p.cost_initialized = true;
      p.current_stock = Math.round((p.current_stock + body.quantity) * 1000) / 1000;
      const id = uid("m");
      db.movements.push({ id, product_id: p.id, quantity: body.quantity, movement_date: body.date, note: body.note, total_cost: body.totalCost, unit_cost: body.totalCost / body.quantity, created_at: new Date().toISOString() });
      checkAlerts(db, p.id);
      return { id };
    });
  },
  async updateStock(id: string, body: Any) { await wait(300); mutate((db) => { const m = db.movements.find((x: Any) => x.id === id); const p = db.products.find((x: Any) => x.id === m.product_id); p.current_stock += body.quantity - m.quantity; Object.assign(m, { quantity: body.quantity, movement_date: body.date, note: body.note, total_cost: body.totalCost }); checkAlerts(db, p.id); }); return { id }; },
  async deleteStock(id: string) { await wait(300); mutate((db) => { const m = db.movements.find((x: Any) => x.id === id); const p = db.products.find((x: Any) => x.id === m.product_id); p.current_stock -= m.quantity; db.movements = db.movements.filter((x: Any) => x.id !== id); checkAlerts(db, p.id); }); },
  async setMaterialCostBaseline(productId: string, unitCost: number) { await wait(300); mutate((db) => { const p = db.products.find((x: Any) => x.id === productId); p.avg = unitCost; p.cost_initialized = true; }); },
  async createSale(payment: string, items: Array<{ productId: string; quantity: number }>, cashReceived: number | null, clientReference: string) {
    await wait(900);
    const user = requireRole("staff");
    return mutate((db) => {
      const existing = db.sales.find((s: Any) => s.client_reference === clientReference);
      const shift = db.shifts.find((s: Any) => s.status === "Open" && s.opened_by === user.id);
      if (!existing && !shift) throw new Error("Open a cashier shift before processing a sale.");
      const need = new Map<string, number>();
      for (const it of items) { const p = db.products.find((x: Any) => x.id === it.productId); if (p.tracks_inventory) for (const r of recipeOf(db, p.id)) need.set(r.ingredient_id, (need.get(r.ingredient_id) ?? 0) + r.quantity * it.quantity); }
      for (const [iid, q] of need) { const ing = db.products.find((x: Any) => x.id === iid); if (ing.current_stock + 1e-9 < q) throw new Error(`Not enough ${ing.name} for this order.`); }
      const total = items.reduce((t, it) => t + db.products.find((x: Any) => x.id === it.productId).price * it.quantity, 0);
      if (payment === "Cash" && (cashReceived ?? 0) + 1e-9 < total) throw new Error("Cash received must cover the order total.");
      const sale = existing ?? recordSale(db, { payment, lines: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })), date: manilaDate(), createdAt: new Date().toISOString(), shiftId: shift.id, cashReceived, clientReference, applyStock: true });
      for (const iid of need.keys()) checkAlerts(db, iid);
      return [{ id: sale.id, receipt: sale.receipt, total: sale.total, cashReceived: sale.cash_received, change: sale.change }][0];
    });
  },
  async updateSaleStatus(id: string, status: string) {
    await wait(500);
    mutate((db) => {
      const s = db.sales.find((x: Any) => x.id === id);
      if (s.status === status) return;
      const sign = status === "Cancelled" ? 1 : -1;
      for (const u of db.usage.filter((x: Any) => x.sale_id === id)) { const ing = db.products.find((x: Any) => x.id === u.ingredient_id); ing.current_stock = Math.round((ing.current_stock + sign * u.quantity) * 1000) / 1000; checkAlerts(db, ing.id); }
      s.status = status;
    });
    return { id, status };
  },
  async openCashShift(openingBalance: number) { await wait(500); const user = requireRole("staff"); return mutate((db) => { const id = uid("s"); db.shifts.push({ id, opened_by: user.id, cashier_name: user.displayName, status: "Open", opening: openingBalance, opened_at: new Date().toISOString(), closed_at: null, counted: null, note: "" }); return id; }); },
  async recordCashMovement(shiftId: string, type: string, amount: number, reason: string) { await wait(400); return mutate((db) => { const id = uid("cm"); db.cashMovements.push({ id, shift_id: shiftId, movement_type: type, amount, reason, created_at: new Date().toISOString() }); return id; }); },
  async closeCashShift(shiftId: string, countedCash: number, note: string) { await wait(500); mutate((db) => { const s = db.shifts.find((x: Any) => x.id === shiftId); Object.assign(s, { status: "Closed", counted: countedCash, note, closed_at: new Date().toISOString() }); }); },
  async forceCloseCashShift(shiftId: string, countedCash: number, note: string) { await wait(500); mutate((db) => { const s = db.shifts.find((x: Any) => x.id === shiftId); Object.assign(s, { status: "Closed", counted: countedCash, note, closed_at: new Date().toISOString() }); }); },
  async notifications() {
    await wait(120);
    const u = requireRole(); const db = load();
    const reads = new Set(db.reads.filter((r: Any) => r.user_id === u.id).map((r: Any) => r.notification_id));
    const list = [...db.notifications].sort((a: Any, b: Any) => (Number(b.active) - Number(a.active)) || b.created_at.localeCompare(a.created_at)).map((n: Any) => ({ id: n.id, type: n.type, severity: n.severity, title: n.title, message: n.message, productId: n.product_id, createdAt: n.created_at, active: n.active ? 1 : 0, isRead: reads.has(n.id) ? 1 : 0 }));
    return { notifications: list, unread: list.filter((n: Any) => n.active && !n.isRead).length };
  },
  async readNotification(id: string) { const u = requireRole(); mutate((db) => { db.reads.push({ notification_id: id, user_id: u.id }); }); },
  async readAllNotifications() { const u = requireRole(); mutate((db) => { db.notifications.filter((n: Any) => n.active).forEach((n: Any) => db.reads.push({ notification_id: n.id, user_id: u.id })); }); },
  report: buildReport,
  inventoryReport: buildInventoryReport,
  async downloadReport() { await wait(900); },
  async downloadInventoryReport() { await wait(900); },
  subscribeWorkspace(onChange: () => void) { listeners.add(onChange); return () => { listeners.delete(onChange); }; },
  subscribeSessionExpiry(_onExpired: () => void) { return () => undefined; },
};

function saveProduct(id: string, form: FormData): Any {
  mutate((db) => {
    const type = String(form.get("productType"));
    const recipe = JSON.parse(String(form.get("recipe") ?? "[]")).map((r: Any) => [r.ingredientId, Number(r.quantity)]);
    const existing = db.products.find((p: Any) => p.id === id);
    const cat = String(form.get("categoryId"));
    const category = db.categories.find((c: Any) => c.id === cat);
    const next = { id, name: String(form.get("name") ?? "").trim(), category_id: cat, product_type: type, tracks_inventory: type === "raw_material" || !["Pastries", "Pasta"].includes(category?.name), unit: String(form.get("unit") ?? "serving"), current_stock: existing?.current_stock ?? 0, low_stock_threshold: Number(form.get("lowStockThreshold") ?? 0), avg: existing?.avg ?? 0, cost_initialized: existing?.cost_initialized ?? false, price: Number(form.get("price") ?? 0), image: existing?.image ?? art("☕", "#f1dcc4", "#8b5a35"), recipe };
    if (existing) Object.assign(existing, next); else db.products.push(next);
  });
  return appData().products.find((p: Any) => p.id === id);
}
