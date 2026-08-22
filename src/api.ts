import { createClient, type User } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff";
export type PaymentMethod = "Cash" | "GCash" | "Maya";
export type SaleStatus = "Completed" | "Cancelled";
export type ProductType = "raw_material" | "finished_product";

export interface UserSession { id: string; email: string; displayName: string; role: UserRole; avatarUrl: string | null }
export interface Category { id: string; name: string }
export interface RecipeIngredient { ingredientId: string; quantity: number }
export interface Product { id: string; name: string; categoryId: string; type: ProductType; tracksInventory: boolean; unit: string; currentStock: number; availableStock: number; lowStockThreshold: number; averageUnitCost: number; costInitialized: boolean; price: number; imageUrl: string | null; recipe: RecipeIngredient[] }
export interface StockMovement { id: string; productId: string; quantity: number; date: string; note: string; totalCost: number | null; unitCost: number | null }
export interface SaleItem { productId: string; name: string; quantity: number; unitPrice: number }
export interface Sale { id: string; receipt: string; date: string; payment: PaymentMethod; status: SaleStatus; total: number; items: SaleItem[]; createdAt: string; createdBy: string; cashierName: string; cashShiftId: string | null; cashReceived: number | null; change: number | null }
export interface CashMovement { id: string; shiftId: string; type: "Cash In" | "Cash Out"; amount: number; reason: string; createdAt: string }
export interface CashShift { id: string; openedBy: string; cashierName: string; status: "Open" | "Closed"; openingBalance: number; openedAt: string; closedAt: string | null; countedCash: number | null; expectedCash: number; variance: number | null; closingNote: string; cashSales: number; digitalSales: number; cashIn: number; cashOut: number }
export interface IngredientUsage { saleId: string; ingredientId: string; ingredientName: string; quantity: number; unit: string }
export interface AppData { categories: Category[]; products: Product[]; stockMovements: StockMovement[]; sales: Sale[]; cashShifts: CashShift[]; cashMovements: CashMovement[]; ingredientUsage: IngredientUsage[] }
export interface NotificationItem { id: string; type: "low_stock" | "out_of_stock"; severity: "warning" | "danger"; title: string; message: string; productId: string; createdAt: string; active: number; isRead: number }
export interface ReportSummary {
  range: { from: string; to: string };
  summary: { totalSalesCentavos: number; totalTransactions: number; averageSaleCentavos: number };
  daily: Array<{ date: string; totalCentavos: number }>;
  topProducts: Array<{ name: string; quantity: number; totalCentavos: number }>;
  payments: Array<{ method: string; transactions: number; totalCentavos: number }>;
  transactions: Array<{ receipt: string; date: string; payment: string; status: string; totalCentavos: number; items: string }>;
}
export interface InventoryReport {
  range: { from: string; to: string };
  summary: { materialCount: number; valuedMaterials: number; totalValueCentavos: number; lowStockCount: number };
  stock: Array<{ name: string; unit: string; quantity: number; averageUnitCostCentavos: number | null; valueCentavos: number | null; threshold: number; status: string }>;
  movements: Array<{ date: string; name: string; quantity: number; unit: string; totalCostCentavos: number | null; note: string }>;
  usage: Array<{ name: string; quantity: number; unit: string }>;
  alerts: Array<{ createdAt: string; resolvedAt: string | null; name: string; type: string; severity: string }>;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "https://vzmcpudoqzyuhgvvwdhg.supabase.co";
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_9-6ELY9Ey8Xq5FRbqu5nGg_OKc3DkuF";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

interface ProfileRow { id: string; display_name: string; role: UserRole; avatar_path: string | null }
interface ProductRow { id: string; name: string; category_id: string; product_type: ProductType; tracks_inventory: boolean; unit: string; current_stock: number | string; low_stock_threshold: number | string; average_unit_cost_centavos: number | string; cost_initialized: boolean; price_centavos: number | string; image_path: string | null }
interface RecipeRow { finished_product_id: string; ingredient_id: string; quantity: number | string }
interface MovementRow { id: string; product_id: string; quantity: number | string; movement_date: string; note: string; total_cost_centavos: number | string | null; unit_cost_centavos: number | string | null }
interface SaleRow { id: string; receipt: string; business_date: string; payment_method: PaymentMethod; status: SaleStatus; total_centavos: number | string; created_at: string; created_by: string; cashier_name: string | null; cash_shift_id: string | null; cash_received_centavos: number | string | null; change_centavos: number | string | null }
interface SaleItemRow { sale_id: string; product_id: string; product_name: string; quantity: number; unit_price_centavos: number | string; line_total_centavos: number | string }
interface NotificationRow { id: string; type: "low_stock" | "out_of_stock"; severity: "warning" | "danger"; title: string; message: string; product_id: string; created_at: string; resolved_at?: string | null; active: boolean }
interface CashShiftRow { id: string; opened_by: string; cashier_name: string; status: "Open" | "Closed"; opening_balance_centavos: number | string; opened_at: string; closed_at: string | null; counted_cash_centavos: number | string | null; expected_cash_centavos: number | string; variance_centavos: number | string | null; closing_note: string; cash_sales_centavos: number | string; digital_sales_centavos: number | string; cash_in_centavos: number | string; cash_out_centavos: number | string }
interface CashMovementRow { id: string; shift_id: string; movement_type: "Cash In" | "Cash Out"; amount_centavos: number | string; reason: string; created_at: string }
interface UsageRow { sale_id: string; ingredient_id: string; ingredient_name: string; quantity: number | string; unit: string }

function message(error: { message?: string } | null | undefined, fallback = "The request could not be completed."): string {
  if (!error?.message) return fallback;
  return error.message.replace(/^new row violates row-level security policy.*$/i, "You do not have permission to perform this action.");
}

function fail(error: { message?: string } | null | undefined, fallback?: string): never {
  throw new Error(message(error, fallback));
}

function storageUrl(bucket: "product-images" | "avatars", path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function currentUser(): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) fail(error, "Not signed in.");
  return data.user;
}

async function profileSession(user: User): Promise<UserSession> {
  const { data, error } = await supabase.from("profiles").select("id, display_name, role, avatar_path").eq("id", user.id).single();
  if (error || !data) fail(error, "This account has not been configured. Run the Supabase user setup SQL.");
  const profile = data as ProfileRow;
  return { id: user.id, email: user.email ?? "", displayName: profile.display_name, role: profile.role, avatarUrl: storageUrl("avatars", profile.avatar_path) };
}

function safeExtension(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function validateImage(file: File): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");
}

async function removeStorageFile(bucket: "product-images" | "avatars", path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) fail(error);
}

async function loadAppData(): Promise<AppData> {
  const [categoryResult, productResult, recipeResult, movementResult, saleResult, itemResult, shiftResult, cashMovementResult, usageResult] = await Promise.all([
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("products").select("id, name, category_id, product_type, tracks_inventory, unit, current_stock, low_stock_threshold, average_unit_cost_centavos, cost_initialized, price_centavos, image_path").eq("active", true).order("name"),
    supabase.from("product_recipes").select("finished_product_id, ingredient_id, quantity").order("created_at"),
    supabase.from("inventory_movements").select("id, product_id, quantity, movement_date, note, total_cost_centavos, unit_cost_centavos").order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("sales").select("id, receipt, business_date, payment_method, status, total_centavos, created_at, created_by, cashier_name, cash_shift_id, cash_received_centavos, change_centavos").order("business_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("sale_items").select("sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos"),
    supabase.from("cash_shift_summaries").select("id, opened_by, cashier_name, status, opening_balance_centavos, opened_at, closed_at, counted_cash_centavos, expected_cash_centavos, variance_centavos, closing_note, cash_sales_centavos, digital_sales_centavos, cash_in_centavos, cash_out_centavos").order("opened_at", { ascending: false }).limit(500),
    supabase.from("cash_movements").select("id, shift_id, movement_type, amount_centavos, reason, created_at").order("created_at", { ascending: false }).limit(1000),
    supabase.from("sale_ingredient_usage").select("sale_id, ingredient_id, ingredient_name, quantity, unit"),
  ]);
  for (const result of [categoryResult, productResult, recipeResult, movementResult, saleResult, itemResult, shiftResult, cashMovementResult, usageResult]) if (result.error) fail(result.error);
  const itemRows = (itemResult.data ?? []) as SaleItemRow[];
  const itemsBySale = new Map<string, SaleItem[]>();
  for (const row of itemRows) {
    const item = { productId: row.product_id, name: row.product_name, quantity: row.quantity, unitPrice: Number(row.unit_price_centavos) / 100 };
    itemsBySale.set(row.sale_id, [...(itemsBySale.get(row.sale_id) ?? []), item]);
  }
  const recipeRows = (recipeResult.data ?? []) as RecipeRow[];
  const products: Product[] = ((productResult.data ?? []) as ProductRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    type: row.product_type,
    tracksInventory: row.tracks_inventory,
    unit: row.unit,
    currentStock: Number(row.current_stock),
    availableStock: 0,
    lowStockThreshold: Number(row.low_stock_threshold),
    averageUnitCost: Number(row.average_unit_cost_centavos) / 100,
    costInitialized: row.cost_initialized,
    price: Number(row.price_centavos) / 100,
    imageUrl: storageUrl("product-images", row.image_path),
    recipe: recipeRows
      .filter((recipe) => recipe.finished_product_id === row.id)
      .map((recipe) => ({ ingredientId: recipe.ingredient_id, quantity: Number(recipe.quantity) })),
  }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  for (const product of products) {
    product.availableStock = product.type === "raw_material"
      ? Math.floor(product.currentStock)
      : !product.tracksInventory
        ? Number.MAX_SAFE_INTEGER
        : product.recipe.length
          ? Math.max(0, Math.min(...product.recipe.map((recipe) => {
              const ingredient = productsById.get(recipe.ingredientId);
              return ingredient?.type === "raw_material" && recipe.quantity > 0
                ? Math.floor(ingredient.currentStock / recipe.quantity)
                : 0;
            })))
          : 0;
  }
  const sales: Sale[] = ((saleResult.data ?? []) as SaleRow[]).map((row) => ({
    id: row.id, receipt: row.receipt, date: row.business_date, payment: row.payment_method, status: row.status,
    total: Number(row.total_centavos) / 100, items: itemsBySale.get(row.id) ?? [], createdAt: row.created_at, createdBy: row.created_by,
    cashierName: row.cashier_name ?? "Unknown cashier", cashShiftId: row.cash_shift_id,
    cashReceived: row.cash_received_centavos === null ? null : Number(row.cash_received_centavos) / 100,
    change: row.change_centavos === null ? null : Number(row.change_centavos) / 100,
  }));
  const cashMovements: CashMovement[] = ((cashMovementResult.data ?? []) as CashMovementRow[]).map((row) => ({
    id: row.id, shiftId: row.shift_id, type: row.movement_type, amount: Number(row.amount_centavos) / 100, reason: row.reason, createdAt: row.created_at,
  }));
  const shifts: CashShift[] = ((shiftResult.data ?? []) as CashShiftRow[]).map((row) => {
    const cashSales = Number(row.cash_sales_centavos) / 100;
    const digitalSales = Number(row.digital_sales_centavos) / 100;
    const cashIn = Number(row.cash_in_centavos) / 100;
    const cashOut = Number(row.cash_out_centavos) / 100;
    return {
      id: row.id, openedBy: row.opened_by, cashierName: row.cashier_name, status: row.status,
      openingBalance: Number(row.opening_balance_centavos) / 100, openedAt: row.opened_at, closedAt: row.closed_at,
      countedCash: row.counted_cash_centavos === null ? null : Number(row.counted_cash_centavos) / 100,
      expectedCash: Number(row.expected_cash_centavos) / 100,
      variance: row.variance_centavos === null ? null : Number(row.variance_centavos) / 100,
      closingNote: row.closing_note, cashSales, digitalSales, cashIn, cashOut,
    };
  });
  return {
    categories: ((categoryResult.data ?? []) as Category[]),
    products,
    stockMovements: ((movementResult.data ?? []) as MovementRow[]).map((row) => ({ id: row.id, productId: row.product_id, quantity: Number(row.quantity), date: row.movement_date, note: row.note, totalCost: row.total_cost_centavos === null ? null : Number(row.total_cost_centavos) / 100, unitCost: row.unit_cost_centavos === null ? null : Number(row.unit_cost_centavos) / 100 })),
    sales,
    cashShifts: shifts,
    cashMovements,
    ingredientUsage: ((usageResult.data ?? []) as UsageRow[]).map((row) => ({ saleId: row.sale_id, ingredientId: row.ingredient_id, ingredientName: row.ingredient_name, quantity: Number(row.quantity), unit: row.unit })),
  };
}

async function uploadProductImage(productId: string, file: File): Promise<string> {
  validateImage(file);
  const path = `${productId}/${crypto.randomUUID()}.${safeExtension(file)}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
  if (error) fail(error);
  return path;
}

function productInput(form: FormData): {
  name: string;
  categoryId: string;
  type: ProductType;
  unit: string;
  lowStockThreshold: number;
  priceCentavos: number;
  initialStock: number;
  recipe: RecipeIngredient[];
} {
  const type = String(form.get("productType")) as ProductType;
  if (type !== "raw_material" && type !== "finished_product") throw new Error("Select a valid product type.");
  let recipe: RecipeIngredient[] = [];
  try {
    const value: unknown = JSON.parse(String(form.get("recipe") ?? "[]"));
    if (!Array.isArray(value)) throw new Error();
    recipe = value.map((item) => {
      if (!item || typeof item !== "object") throw new Error();
      const ingredientId = String((item as { ingredientId?: unknown }).ingredientId ?? "");
      const quantity = Number((item as { quantity?: unknown }).quantity);
      if (!ingredientId || !Number.isFinite(quantity) || quantity <= 0) throw new Error();
      return { ingredientId, quantity };
    });
  } catch {
    throw new Error("Every recipe ingredient needs a valid positive quantity.");
  }
  if (new Set(recipe.map((item) => item.ingredientId)).size !== recipe.length) throw new Error("Each ingredient can appear only once in a recipe.");
  return {
    name: String(form.get("name") ?? "").trim(),
    categoryId: String(form.get("categoryId") ?? ""),
    type,
    unit: String(form.get("unit") ?? "").trim(),
    lowStockThreshold: Number(form.get("lowStockThreshold") ?? 0),
    priceCentavos: Math.round(Number(form.get("price") ?? 0) * 100),
    initialStock: Number(form.get("currentStock") ?? 0),
    recipe,
  };
}

async function saveCatalogProduct(id: string, imagePath: string | null, form: FormData): Promise<string> {
  const input = productInput(form);
  const { data, error } = await supabase.rpc("save_catalog_product", {
    p_id: id,
    p_name: input.name,
    p_category_id: input.categoryId,
    p_product_type: input.type,
    p_unit: input.unit,
    p_low_stock_threshold: input.lowStockThreshold,
    p_price_centavos: input.priceCentavos,
    p_image_path: imagePath,
    p_recipe: input.recipe.map((item) => ({ ingredient_id: item.ingredientId, quantity: item.quantity })),
    p_initial_stock: input.initialStock,
  });
  if (error) fail(error);
  return String(data);
}

async function buildReport(from: string, to: string): Promise<ReportSummary> {
  if (from > to) throw new Error("Start date must be on or before end date.");
  const data = await loadAppData();
  const sales = data.sales.filter((sale) => sale.date >= from && sale.date <= to);
  const completed = sales.filter((sale) => sale.status === "Completed");
  const totalSalesCentavos = completed.reduce((sum, sale) => sum + Math.round(sale.total * 100), 0);
  const dailyMap = new Map<string, number>();
  const productMap = new Map<string, { quantity: number; totalCentavos: number }>();
  const paymentMap = new Map<string, { transactions: number; totalCentavos: number }>();
  for (const sale of completed) {
    const total = Math.round(sale.total * 100);
    dailyMap.set(sale.date, (dailyMap.get(sale.date) ?? 0) + total);
    const payment = paymentMap.get(sale.payment) ?? { transactions: 0, totalCentavos: 0 };
    payment.transactions += 1; payment.totalCentavos += total; paymentMap.set(sale.payment, payment);
    for (const item of sale.items) {
      const product = productMap.get(item.name) ?? { quantity: 0, totalCentavos: 0 };
      product.quantity += item.quantity; product.totalCentavos += Math.round(item.unitPrice * 100) * item.quantity; productMap.set(item.name, product);
    }
  }
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return {
    range: { from, to },
    summary: { totalSalesCentavos, totalTransactions: completed.length, averageSaleCentavos: completed.length ? Math.round(totalSalesCentavos / completed.length) : 0 },
    daily: dates.map((date) => ({ date, totalCentavos: dailyMap.get(date) ?? 0 })),
    topProducts: [...productMap.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.quantity - a.quantity),
    payments: [...paymentMap.entries()].map(([method, value]) => ({ method, ...value })).sort((a, b) => b.totalCentavos - a.totalCentavos),
    transactions: sales.map((sale) => ({ receipt: sale.receipt, date: sale.date, payment: sale.payment, status: sale.status, totalCentavos: Math.round(sale.total * 100), items: sale.items.map((item) => `${item.name} x${item.quantity}`).join("; ") })),
  };
}

async function buildInventoryReport(from: string, to: string): Promise<InventoryReport> {
  if (from > to) throw new Error("Start date must be on or before end date.");
  const [data, alertResult] = await Promise.all([
    loadAppData(),
    supabase.from("notifications").select("type, severity, product_id, created_at, resolved_at").gte("created_at", `${from}T00:00:00+08:00`).lte("created_at", `${to}T23:59:59+08:00`).order("created_at", { ascending: false }),
  ]);
  if (alertResult.error) fail(alertResult.error);
  const materials = data.products.filter((product) => product.type === "raw_material");
  const stock = materials.map((product) => ({
    name: product.name, unit: product.unit, quantity: product.currentStock,
    averageUnitCostCentavos: product.costInitialized ? Math.round(product.averageUnitCost * 100) : null,
    valueCentavos: product.costInitialized ? Math.round(product.currentStock * product.averageUnitCost * 100) : null,
    threshold: product.lowStockThreshold,
    status: product.currentStock <= 0 ? "Out of stock" : product.currentStock <= product.lowStockThreshold ? "Low stock" : "Available",
  }));
  const completedSaleIds = new Set(data.sales.filter((sale) => sale.status === "Completed" && sale.date >= from && sale.date <= to).map((sale) => sale.id));
  const usageMap = new Map<string, { name: string; quantity: number; unit: string }>();
  data.ingredientUsage.filter((usage) => completedSaleIds.has(usage.saleId)).forEach((usage) => {
    const current = usageMap.get(usage.ingredientId) ?? { name: usage.ingredientName, quantity: 0, unit: usage.unit };
    current.quantity += usage.quantity; usageMap.set(usage.ingredientId, current);
  });
  const productById = new Map(materials.map((product) => [product.id, product]));
  const alerts = ((alertResult.data ?? []) as Array<{ type: string; severity: string; product_id: string; created_at: string; resolved_at: string | null }>).map((row) => ({
    createdAt: row.created_at, resolvedAt: row.resolved_at, name: productById.get(row.product_id)?.name ?? "Deleted material", type: row.type, severity: row.severity,
  }));
  return {
    range: { from, to },
    summary: {
      materialCount: materials.length,
      valuedMaterials: stock.filter((row) => row.valueCentavos !== null).length,
      totalValueCentavos: stock.reduce((sum, row) => sum + (row.valueCentavos ?? 0), 0),
      lowStockCount: stock.filter((row) => row.status !== "Available").length,
    },
    stock,
    movements: data.stockMovements.filter((movement) => movement.date >= from && movement.date <= to).map((movement) => ({
      date: movement.date, name: productById.get(movement.productId)?.name ?? "Deleted material", quantity: movement.quantity,
      unit: productById.get(movement.productId)?.unit ?? "", totalCostCentavos: movement.totalCost === null ? null : Math.round(movement.totalCost * 100), note: movement.note,
    })),
    usage: [...usageMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    alerts,
  };
}

function csvCell(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

async function saveCsv(report: ReportSummary): Promise<void> {
  const header = ["Receipt", "Date", "Payment", "Status", "Total (PHP)", "Items"];
  const rows = report.transactions.map((row) => [row.receipt, row.date, row.payment, row.status, (row.totalCentavos / 100).toFixed(2), row.items]);
  saveBlob(new Blob([[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `halara-sales-${report.range.from}-to-${report.range.to}.csv`);
}

async function savePdf(report: ReportSummary): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  let y = 48;
  const line = (text: string, size = 10, gap = 17): void => { if (y > 790) { pdf.addPage(); y = 48; } pdf.setFontSize(size); pdf.text(text, 42, y); y += gap; };
  line("Halara Coffee Club — Sales Report", 17, 25);
  line(`${report.range.from} to ${report.range.to}`, 10, 22);
  line(`Revenue: PHP ${(report.summary.totalSalesCentavos / 100).toFixed(2)}`, 11);
  line(`Completed transactions: ${report.summary.totalTransactions}`, 11);
  line(`Average sale: PHP ${(report.summary.averageSaleCentavos / 100).toFixed(2)}`, 11, 26);
  line("Top products", 13, 21);
  if (!report.topProducts.length) line("No completed sales in this period.");
  report.topProducts.forEach((item, index) => line(`${index + 1}. ${item.name} — ${item.quantity} units — PHP ${(item.totalCentavos / 100).toFixed(2)}`));
  y += 10; line("Payment breakdown", 13, 21);
  report.payments.forEach((item) => line(`${item.method} — ${item.transactions} transactions — PHP ${(item.totalCentavos / 100).toFixed(2)}`));
  y += 10; line("Transactions", 13, 21);
  report.transactions.forEach((item) => line(`${item.date}  ${item.receipt}  ${item.status}  ${item.payment}  PHP ${(item.totalCentavos / 100).toFixed(2)}`));
  pdf.save(`halara-sales-${report.range.from}-to-${report.range.to}.pdf`);
}

async function saveInventoryCsv(report: InventoryReport): Promise<void> {
  const rows: Array<Array<string | number>> = [["Section", "Date", "Material", "Quantity", "Unit", "Unit Cost PHP", "Value/Cost PHP", "Threshold", "Status/Note"]];
  report.stock.forEach((row) => rows.push(["Current Stock", "", row.name, row.quantity, row.unit, row.averageUnitCostCentavos === null ? "Uncosted" : (row.averageUnitCostCentavos / 100).toFixed(4), row.valueCentavos === null ? "Uncosted" : (row.valueCentavos / 100).toFixed(2), row.threshold, row.status]));
  report.movements.forEach((row) => rows.push(["Stock Movement", row.date, row.name, row.quantity, row.unit, "", row.totalCostCentavos === null ? "Uncosted" : (row.totalCostCentavos / 100).toFixed(2), "", row.note]));
  report.usage.forEach((row) => rows.push(["Ingredient Usage", "", row.name, row.quantity, row.unit, "", "", "", "Completed sales"]));
  report.alerts.forEach((row) => rows.push(["Stock Alert", row.createdAt, row.name, "", "", "", "", "", `${row.type} · ${row.resolvedAt ? "Resolved" : "Active"}`]));
  saveBlob(new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `halara-inventory-${report.range.from}-to-${report.range.to}.csv`);
}

async function saveInventoryPdf(report: InventoryReport): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let y = 16;
  const line = (text: string, size = 9): void => { if (y > 280) { pdf.addPage(); y = 16; } pdf.setFontSize(size); pdf.text(text.slice(0, 110), 14, y); y += size > 12 ? 8 : 5; };
  line("Halara Coffee Club — Inventory Report", 16);
  line(`${report.range.from} to ${report.range.to}`, 10);
  line(`Current valued stock: PHP ${(report.summary.totalValueCentavos / 100).toFixed(2)} · ${report.summary.valuedMaterials}/${report.summary.materialCount} materials costed`, 10); y += 2;
  line("Current stock", 12);
  report.stock.forEach((row) => line(`${row.name}: ${row.quantity} ${row.unit} · threshold ${row.threshold} ${row.unit} · ${row.valueCentavos === null ? "Uncosted" : `PHP ${(row.valueCentavos / 100).toFixed(2)}`} · ${row.status}`));
  y += 3; line("Stock movements", 12);
  report.movements.forEach((row) => line(`${row.date} · ${row.name} +${row.quantity} ${row.unit} · ${row.totalCostCentavos === null ? "Uncosted" : `PHP ${(row.totalCostCentavos / 100).toFixed(2)}`}`));
  y += 3; line("Ingredient consumption", 12);
  report.usage.forEach((row) => line(`${row.name}: ${row.quantity} ${row.unit}`));
  y += 3; line("Low-stock history", 12);
  report.alerts.forEach((row) => line(`${row.createdAt.slice(0, 16).replace("T", " ")} · ${row.name} · ${row.type} · ${row.resolvedAt ? "Resolved" : "Active"}`));
  pdf.save(`halara-inventory-${report.range.from}-to-${report.range.to}.pdf`);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}

export const api = {
  async session(): Promise<UserSession> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) fail(error, "Not signed in.");
    return profileSession(data.session.user);
  },
  async login(role: UserRole, email: string, password: string): Promise<UserSession> {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.user) fail(error, "The email or password is incorrect.");
    const session = await profileSession(data.user);
    if (session.role !== role) { await supabase.auth.signOut(); throw new Error(`This account does not have ${role} access.`); }
    return session;
  },
  async logout(): Promise<void> { const { error } = await supabase.auth.signOut(); if (error) fail(error); },
  async changePassword(currentPassword: string, newPassword: string, confirmPassword: string): Promise<{ message: string }> {
    if (newPassword !== confirmPassword) throw new Error("New passwords do not match.");
    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) throw new Error("Use at least 12 characters with uppercase, lowercase, number, and symbol.");
    const user = await currentUser();
    const login = await supabase.auth.signInWithPassword({ email: user.email ?? "", password: currentPassword });
    if (login.error) throw new Error("The current password is incorrect.");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) fail(error);
    return { message: "Password changed successfully." };
  },
  async updateProfile(data: FormData): Promise<UserSession> {
    const user = await currentUser();
    const { data: current, error: profileError } = await supabase.from("profiles").select("avatar_path").eq("id", user.id).single();
    if (profileError) fail(profileError);
    const previousAvatarPath = (current as { avatar_path: string | null }).avatar_path;
    let avatarPath = previousAvatarPath;
    const file = data.get("avatar");
    const remove = data.get("removeAvatar") === "true";
    if (file instanceof File && file.size) {
      validateImage(file);
      const nextPath = `${user.id}/avatar-${crypto.randomUUID()}.${safeExtension(file)}`;
      const { error } = await supabase.storage.from("avatars").upload(nextPath, file, { cacheControl: "31536000", contentType: file.type });
      if (error) fail(error);
      avatarPath = nextPath;
    } else if (remove) avatarPath = null;
    const displayName = String(data.get("displayName") ?? "").trim();
    const { error } = await supabase.from("profiles").update({ display_name: displayName, avatar_path: avatarPath, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) fail(error);
    if (previousAvatarPath && previousAvatarPath !== avatarPath) await removeStorageFile("avatars", previousAvatarPath);
    return profileSession(user);
  },
  appData: loadAppData,
  async createCategory(name: string): Promise<Category> {
    const { data, error } = await supabase.from("categories").insert({ name: name.trim() }).select("id, name").single();
    if (error || !data) fail(error); return data as Category;
  },
  async updateCategory(id: string, name: string): Promise<Category> {
    const { data, error } = await supabase.from("categories").update({ name: name.trim(), updated_at: new Date().toISOString() }).eq("id", id).select("id, name").single();
    if (error || !data) fail(error); return data as Category;
  },
  async deleteCategory(id: string): Promise<void> { const { error } = await supabase.from("categories").delete().eq("id", id); if (error) fail(error); },
  async createProduct(form: FormData): Promise<Product> {
    const id = crypto.randomUUID();
    const file = form.get("image");
    let imagePath: string | null = null;
    try {
      if (file instanceof File && file.size) imagePath = await uploadProductImage(id, file);
      await saveCatalogProduct(id, imagePath, form);
    } catch (error) {
      if (imagePath) await removeStorageFile("product-images", imagePath).catch(() => undefined);
      throw error;
    }
    const products = (await loadAppData()).products; return products.find((product) => product.id === id)!;
  },
  async updateProduct(id: string, form: FormData): Promise<Product> {
    const { data: existing, error: existingError } = await supabase.from("products").select("image_path").eq("id", id).single();
    if (existingError || !existing) fail(existingError);
    const previousImagePath = (existing as { image_path: string | null }).image_path;
    let imagePath = previousImagePath;
    const file = form.get("image");
    let uploadedImagePath: string | null = null;
    if (file instanceof File && file.size) {
      uploadedImagePath = await uploadProductImage(id, file);
      imagePath = uploadedImagePath;
    }
    else if (form.get("removeImage") === "true") imagePath = null;
    try {
      await saveCatalogProduct(id, imagePath, form);
    } catch (error) {
      if (uploadedImagePath) await removeStorageFile("product-images", uploadedImagePath);
      throw error;
    }
    if (previousImagePath && previousImagePath !== imagePath) await removeStorageFile("product-images", previousImagePath);
    return (await loadAppData()).products.find((product) => product.id === id)!;
  },
  async deleteProduct(id: string): Promise<void> {
    const { data } = await supabase.from("products").select("image_path").eq("id", id).single();
    const { error } = await supabase.from("products").delete().eq("id", id); if (error) fail(error);
    await removeStorageFile("product-images", (data as { image_path: string | null } | null)?.image_path ?? null);
  },
  async createStock(body: { productId: string; quantity: number; date: string; note: string; totalCost: number }): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("add_stock", { p_product_id: body.productId, p_quantity: body.quantity, p_date: body.date, p_note: body.note, p_total_cost_centavos: Math.round(body.totalCost * 100) });
    if (error) fail(error); return { id: String(data) };
  },
  async updateStock(id: string, body: { quantity: number; date: string; note: string; totalCost: number }): Promise<{ id: string }> {
    const { error } = await supabase.rpc("update_stock_entry", { p_id: id, p_quantity: body.quantity, p_date: body.date, p_note: body.note, p_total_cost_centavos: Math.round(body.totalCost * 100) });
    if (error) fail(error); return { id };
  },
  async deleteStock(id: string): Promise<void> { const { error } = await supabase.rpc("delete_stock_entry", { p_id: id }); if (error) fail(error); },
  async setMaterialCostBaseline(productId: string, unitCost: number): Promise<void> {
    const { error } = await supabase.rpc("set_material_cost_baseline", { p_product_id: productId, p_unit_cost_centavos: unitCost * 100 }); if (error) fail(error);
  },
  async createSale(payment: PaymentMethod, items: Array<{ productId: string; quantity: number }>, cashReceived: number | null, clientReference: string): Promise<{ id: string; receipt: string; total: number; cashReceived: number | null; change: number | null }> {
    const { data, error } = await supabase.rpc("create_sale", { p_payment: payment, p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })), p_cash_received_centavos: cashReceived === null ? null : Math.round(cashReceived * 100), p_client_reference: clientReference });
    if (error) fail(error); const row = (data as Array<{ id: string; receipt: string; total_centavos: number | string; cash_received_centavos: number | string | null; change_centavos: number | string | null }>)[0];
    if (!row) throw new Error("The sale was not created."); return { id: row.id, receipt: row.receipt, total: Number(row.total_centavos) / 100, cashReceived: row.cash_received_centavos === null ? null : Number(row.cash_received_centavos) / 100, change: row.change_centavos === null ? null : Number(row.change_centavos) / 100 };
  },
  async updateSaleStatus(id: string, status: SaleStatus): Promise<{ id: string; status: SaleStatus }> { const { error } = await supabase.rpc("set_sale_status", { p_sale_id: id, p_status: status }); if (error) fail(error); return { id, status }; },
  async openCashShift(openingBalance: number): Promise<string> { const { data, error } = await supabase.rpc("open_cash_shift", { p_opening_balance_centavos: Math.round(openingBalance * 100) }); if (error) fail(error); return String(data); },
  async recordCashMovement(shiftId: string, type: "Cash In" | "Cash Out", amount: number, reason: string): Promise<string> { const { data, error } = await supabase.rpc("record_cash_movement", { p_shift_id: shiftId, p_type: type, p_amount_centavos: Math.round(amount * 100), p_reason: reason.trim() }); if (error) fail(error); return String(data); },
  async closeCashShift(shiftId: string, countedCash: number, note: string): Promise<void> { const { error } = await supabase.rpc("close_cash_shift", { p_shift_id: shiftId, p_counted_cash_centavos: Math.round(countedCash * 100), p_note: note.trim() }); if (error) fail(error); },
  async forceCloseCashShift(shiftId: string, countedCash: number, note: string): Promise<void> { const { error } = await supabase.rpc("force_close_cash_shift", { p_shift_id: shiftId, p_counted_cash_centavos: Math.round(countedCash * 100), p_note: note.trim() }); if (error) fail(error); },
  async notifications(): Promise<{ notifications: NotificationItem[]; unread: number }> {
    const user = await currentUser();
    const [notificationResult, readResult] = await Promise.all([
      supabase.from("notifications").select("id, type, severity, title, message, product_id, created_at, active").order("active", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    if (notificationResult.error) fail(notificationResult.error); if (readResult.error) fail(readResult.error);
    const readIds = new Set(((readResult.data ?? []) as Array<{ notification_id: string }>).map((row) => row.notification_id));
    const notifications = ((notificationResult.data ?? []) as NotificationRow[]).map((row) => ({ id: row.id, type: row.type, severity: row.severity, title: row.title, message: row.message, productId: row.product_id, createdAt: row.created_at, active: row.active ? 1 : 0, isRead: readIds.has(row.id) ? 1 : 0 }));
    return { notifications, unread: notifications.filter((item) => item.active && !item.isRead).length };
  },
  async readNotification(id: string): Promise<void> { const user = await currentUser(); const { error } = await supabase.from("notification_reads").upsert({ notification_id: id, user_id: user.id, read_at: new Date().toISOString() }); if (error) fail(error); },
  async readAllNotifications(): Promise<void> {
    const user = await currentUser(); const { data, error } = await supabase.from("notifications").select("id").eq("active", true); if (error) fail(error);
    if (!data?.length) return; const rows = data.map((item) => ({ notification_id: item.id, user_id: user.id, read_at: new Date().toISOString() }));
    const result = await supabase.from("notification_reads").upsert(rows); if (result.error) fail(result.error);
  },
  report: buildReport,
  inventoryReport: buildInventoryReport,
  async downloadReport(format: "pdf" | "csv", from: string, to: string): Promise<void> { const report = await buildReport(from, to); if (format === "pdf") await savePdf(report); else await saveCsv(report); },
  async downloadInventoryReport(format: "pdf" | "csv", from: string, to: string): Promise<void> { const report = await buildInventoryReport(from, to); if (format === "pdf") await saveInventoryPdf(report); else await saveInventoryCsv(report); },
  subscribeWorkspace(onChange: () => void): () => void {
    const tables = ["products", "inventory_movements", "sales", "sale_items", "sale_ingredient_usage", "notifications", "notification_reads", "cash_shifts", "cash_movements"];
    let channel = supabase.channel(`workspace-${crypto.randomUUID()}`);
    tables.forEach((table) => { channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange); });
    void channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
  subscribeSessionExpiry(onExpired: () => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") onExpired();
    });
    return () => data.subscription.unsubscribe();
  },
};
