import { createClient, type User } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff";
export type PaymentMethod = "Cash" | "GCash" | "Maya";
export type SaleStatus = "Completed" | "Cancelled";
export type ProductType = "raw_material" | "finished_product";

export interface UserSession { id: string; email: string; displayName: string; role: UserRole; avatarUrl: string | null }
export interface Category { id: string; name: string }
export interface RecipeIngredient { ingredientId: string; quantity: number }
export interface Product { id: string; name: string; categoryId: string; type: ProductType; unit: string; currentStock: number; availableStock: number; lowStockThreshold: number; price: number; imageUrl: string | null; recipe: RecipeIngredient[] }
export interface StockMovement { id: string; productId: string; quantity: number; date: string; note: string }
export interface SaleItem { productId: string; name: string; quantity: number; unitPrice: number }
export interface Sale { id: string; receipt: string; date: string; payment: PaymentMethod; status: SaleStatus; total: number; items: SaleItem[]; createdAt: string }
export interface AppData { categories: Category[]; products: Product[]; stockMovements: StockMovement[]; sales: Sale[] }
export interface NotificationItem { id: string; type: "low_stock" | "out_of_stock"; severity: "warning" | "danger"; title: string; message: string; productId: string; createdAt: string; active: number; isRead: number }
export interface ReportSummary {
  range: { from: string; to: string };
  summary: { totalSalesCentavos: number; totalTransactions: number; averageSaleCentavos: number };
  daily: Array<{ date: string; totalCentavos: number }>;
  topProducts: Array<{ name: string; quantity: number; totalCentavos: number }>;
  payments: Array<{ method: string; transactions: number; totalCentavos: number }>;
  transactions: Array<{ receipt: string; date: string; payment: string; status: string; totalCentavos: number; items: string }>;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "https://vzmcpudoqzyuhgvvwdhg.supabase.co";
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_9-6ELY9Ey8Xq5FRbqu5nGg_OKc3DkuF";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

interface ProfileRow { id: string; display_name: string; role: UserRole; avatar_path: string | null }
interface ProductRow { id: string; name: string; category_id: string; product_type: ProductType; unit: string; current_stock: number | string; low_stock_threshold: number | string; price_centavos: number | string; image_path: string | null }
interface RecipeRow { finished_product_id: string; ingredient_id: string; quantity: number | string }
interface MovementRow { id: string; product_id: string; quantity: number | string; movement_date: string; note: string }
interface SaleRow { id: string; receipt: string; business_date: string; payment_method: PaymentMethod; status: SaleStatus; total_centavos: number | string; created_at: string }
interface SaleItemRow { sale_id: string; product_id: string; product_name: string; quantity: number; unit_price_centavos: number | string; line_total_centavos: number | string }
interface NotificationRow { id: string; type: "low_stock" | "out_of_stock"; severity: "warning" | "danger"; title: string; message: string; product_id: string; created_at: string; active: boolean }

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
  const [categoryResult, productResult, recipeResult, movementResult, saleResult, itemResult] = await Promise.all([
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("products").select("id, name, category_id, product_type, unit, current_stock, low_stock_threshold, price_centavos, image_path").eq("active", true).order("name"),
    supabase.from("product_recipes").select("finished_product_id, ingredient_id, quantity").order("created_at"),
    supabase.from("inventory_movements").select("id, product_id, quantity, movement_date, note").order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("sales").select("id, receipt, business_date, payment_method, status, total_centavos, created_at").order("business_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("sale_items").select("sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos"),
  ]);
  for (const result of [categoryResult, productResult, recipeResult, movementResult, saleResult, itemResult]) if (result.error) fail(result.error);
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
    unit: row.unit,
    currentStock: Number(row.current_stock),
    availableStock: 0,
    lowStockThreshold: Number(row.low_stock_threshold),
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
      : product.recipe.length
        ? Math.max(0, Math.min(...product.recipe.map((recipe) => {
            const ingredient = productsById.get(recipe.ingredientId);
            return ingredient?.type === "raw_material" && recipe.quantity > 0
              ? Math.floor(ingredient.currentStock / recipe.quantity)
              : 0;
          })))
        : 0;
  }
  return {
    categories: ((categoryResult.data ?? []) as Category[]),
    products,
    stockMovements: ((movementResult.data ?? []) as MovementRow[]).map((row) => ({ id: row.id, productId: row.product_id, quantity: Number(row.quantity), date: row.movement_date, note: row.note })),
    sales: ((saleResult.data ?? []) as SaleRow[]).map((row) => ({ id: row.id, receipt: row.receipt, date: row.business_date, payment: row.payment_method, status: row.status, total: Number(row.total_centavos) / 100, items: itemsBySale.get(row.id) ?? [], createdAt: row.created_at })),
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
  async createStock(body: { productId: string; quantity: number; date: string; note: string }): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc("add_stock", { p_product_id: body.productId, p_quantity: body.quantity, p_date: body.date, p_note: body.note });
    if (error) fail(error); return { id: String(data) };
  },
  async updateStock(id: string, body: { quantity: number; date: string; note: string }): Promise<{ id: string }> {
    const { error } = await supabase.rpc("update_stock_entry", { p_id: id, p_quantity: body.quantity, p_date: body.date, p_note: body.note });
    if (error) fail(error); return { id };
  },
  async deleteStock(id: string): Promise<void> { const { error } = await supabase.rpc("delete_stock_entry", { p_id: id }); if (error) fail(error); },
  async createSale(payment: PaymentMethod, items: Array<{ productId: string; quantity: number }>): Promise<{ id: string; receipt: string; total: number }> {
    const { data, error } = await supabase.rpc("create_sale", { p_payment: payment, p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })) });
    if (error) fail(error); const row = (data as Array<{ id: string; receipt: string; total_centavos: number | string }>)[0];
    if (!row) throw new Error("The sale was not created."); return { id: row.id, receipt: row.receipt, total: Number(row.total_centavos) / 100 };
  },
  async updateSaleStatus(id: string, status: SaleStatus): Promise<{ id: string; status: SaleStatus }> { const { error } = await supabase.rpc("set_sale_status", { p_sale_id: id, p_status: status }); if (error) fail(error); return { id, status }; },
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
  async downloadReport(format: "pdf" | "csv", from: string, to: string): Promise<void> { const report = await buildReport(from, to); if (format === "pdf") await savePdf(report); else await saveCsv(report); },
};
