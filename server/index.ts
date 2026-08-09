import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp, { type Metadata } from "sharp";
import argon2 from "argon2";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { createDatabase, getBusinessDate, roundQuantity, type DatabaseContext } from "./db.js";
import {
  clearSessionCookie,
  createSession,
  protectMutation,
  requireRole,
  requireUser,
  sessionMiddleware,
  setSessionCookie,
  type AuthenticatedRequest,
  type UserRole,
} from "./auth.js";
import { buildSalesReport, reportCsv, streamReportPdf } from "./reports.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roleSchema = z.enum(["admin", "staff"]);
const paymentSchema = z.enum(["Cash", "GCash", "Maya"]);
const productFields = z.object({
  name: z.string().trim().min(1).max(80),
  categoryId: z.string().uuid(),
  unit: z.string().trim().min(1).max(12),
  currentStock: z.coerce.number().min(0).max(1_000_000),
  lowStockThreshold: z.coerce.number().min(0).max(1_000_000),
  price: z.coerce.number().min(0).max(10_000_000),
  removeImage: z.preprocess(
    (value) => value === true || value === "true" || value === "1",
    z.boolean(),
  ).optional().default(false),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

interface AppOptions {
  dataDir?: string;
  serveFrontend?: boolean;
  skipNotFound?: boolean;
}

interface ProductRow {
  id: string;
  name: string;
  category_id: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
  price_centavos: number;
  storage_path: string | null;
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function asyncRoute(
  handler: (request: AuthenticatedRequest, response: Response) => Promise<void> | void,
) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

function mapProduct(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    unit: row.unit,
    currentStock: row.current_stock,
    lowStockThreshold: row.low_stock_threshold,
    price: row.price_centavos / 100,
    imageUrl: row.storage_path ? `/uploads/products/${path.basename(row.storage_path)}` : null,
  };
}

function getProductRow(db: Database.Database, id: string): ProductRow | undefined {
  return db.prepare(`
    SELECT p.*, pi.storage_path
    FROM products p LEFT JOIN product_images pi ON pi.product_id = p.id
    WHERE p.id = ? AND p.active = 1
  `).get(id) as ProductRow | undefined;
}

function syncInventoryAlert(db: Database.Database, productId: string): void {
  const product = db.prepare(
    "SELECT id, name, current_stock, low_stock_threshold, unit FROM products WHERE id = ?",
  ).get(productId) as
    | { id: string; name: string; current_stock: number; low_stock_threshold: number; unit: string }
    | undefined;
  if (!product) return;
  const active = db.prepare(
    "SELECT id FROM notifications WHERE dedupe_key = ? AND active = 1",
  ).get(`inventory:${productId}`) as { id: string } | undefined;
  if (product.current_stock > product.low_stock_threshold) {
    if (active) {
      db.prepare("UPDATE notifications SET active = 0, resolved_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(active.id);
    }
    return;
  }
  const type = product.current_stock <= 0 ? "out_of_stock" : "low_stock";
  const severity = type === "out_of_stock" ? "danger" : "warning";
  const title = type === "out_of_stock" ? `${product.name} is out of stock` : `${product.name} is running low`;
  const message = `${product.current_stock} ${product.unit} remaining; threshold is ${product.low_stock_threshold} ${product.unit}.`;
  if (active) {
    db.prepare("UPDATE notifications SET type = ?, severity = ?, title = ?, message = ? WHERE id = ?")
      .run(type, severity, title, message, active.id);
  } else {
    db.prepare(`
      INSERT INTO notifications(id, type, severity, title, message, product_id, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), type, severity, title, message, productId, `inventory:${productId}`);
  }
}

async function saveProductImage(
  context: DatabaseContext,
  productId: string,
  file: Express.Multer.File,
): Promise<{ storagePath: string; originalName: string; mimeType: string; sizeBytes: number }> {
  let metadata: Metadata;
  try {
    metadata = await sharp(file.buffer).metadata();
  } catch {
    throw new ApiError(400, "The selected file is not a valid image.");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new ApiError(400, "Use a JPEG, PNG, or WebP product image.");
  }
  let output: Buffer;
  try {
    output = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new ApiError(400, "The selected image could not be processed.");
  }
  const filename = `${productId}-${randomUUID()}.webp`;
  const storagePath = path.join(context.uploadsDir, filename);
  await mkdir(context.uploadsDir, { recursive: true });
  await writeFile(storagePath, output, { flag: "wx" });
  return { storagePath, originalName: file.originalname, mimeType: "image/webp", sizeBytes: output.length };
}

async function saveAvatarImage(
  context: DatabaseContext,
  userId: string,
  file: Express.Multer.File,
): Promise<{ storagePath: string; sizeBytes: number }> {
  let output: Buffer;
  try {
    output = await sharp(file.buffer)
      .rotate()
      .resize({ width: 600, height: 600, fit: "cover" })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    throw new ApiError(400, "The selected profile image could not be processed.");
  }
  const filename = `${userId}-${randomUUID()}.webp`;
  const storagePath = path.join(context.avatarsDir, filename);
  await writeFile(storagePath, output, { flag: "wx" });
  return { storagePath, sizeBytes: output.length };
}

async function safeUnlink(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  try { await unlink(filePath); } catch { /* The database remains authoritative. */ }
}

function appData(db: Database.Database) {
  const categories = db.prepare("SELECT id, name FROM categories ORDER BY name").all();
  const products = (db.prepare(`
    SELECT p.*, pi.storage_path FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id
    WHERE p.active = 1 ORDER BY p.name
  `).all() as ProductRow[]).map(mapProduct);
  const movements = db.prepare(`
    SELECT id, product_id AS productId, quantity, movement_date AS date, note
    FROM inventory_movements ORDER BY movement_date DESC, created_at DESC
  `).all();
  const saleRows = db.prepare(`
    SELECT id, receipt, business_date AS date, payment_method AS payment,
           status, total_centavos AS totalCentavos, created_at AS createdAt
    FROM sales ORDER BY business_date DESC, created_at DESC
  `).all() as Array<Record<string, unknown> & { id: string }>;
  const itemRows = db.prepare(`
    SELECT sale_id AS saleId, product_id AS productId, product_name AS name,
           quantity, unit_price_centavos AS unitPriceCentavos
    FROM sale_items ORDER BY rowid
  `).all() as Array<{ saleId: string; productId: string; name: string; quantity: number; unitPriceCentavos: number }>;
  const itemsBySale = new Map<string, typeof itemRows>();
  itemRows.forEach((item) => itemsBySale.set(item.saleId, [...(itemsBySale.get(item.saleId) ?? []), item]));
  const sales = saleRows.map((sale) => ({
    ...sale,
    total: Number(sale.totalCentavos) / 100,
    items: (itemsBySale.get(sale.id) ?? []).map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPriceCentavos / 100,
    })),
  }));
  return { categories, products, stockMovements: movements, sales };
}

export async function createApp(options: AppOptions = {}) {
  const context = await createDatabase(options.dataDir);
  const { db } = context;
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: process.env.NODE_ENV === "production"
          ? ["'self'"]
          : ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: "256kb" }));
  app.use(sessionMiddleware(db));
  app.use("/uploads", express.static(path.join(context.dataDir, "uploads"), { fallthrough: false }));

  const loginLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

  app.post("/api/auth/login", loginLimiter, asyncRoute(async (request, response) => {
    const input = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(1), role: roleSchema }).parse(request.body);
    const row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(input.email) as
      | { id: string; email: string; display_name: string; role: UserRole; avatar_path: string | null; password_hash: string }
      | undefined;
    const valid = row ? await argon2.verify(row.password_hash, input.password) : false;
    if (!row || !valid || row.role !== input.role) throw new ApiError(401, "The email, password, or selected role is incorrect.");
    const session = createSession(db, row.id);
    setSessionCookie(response, session.token, session.expiresAt);
    response.json({ user: { id: row.id, email: row.email, displayName: row.display_name, role: row.role, avatarUrl: row.avatar_path ? `/uploads/avatars/${path.basename(row.avatar_path)}` : null }, csrfToken: session.csrfToken });
  }));

  app.get("/api/auth/session", asyncRoute((request, response) => {
    if (!request.user) { response.status(401).json({ error: "Not signed in." }); return; }
    const { csrfToken, ...user } = request.user;
    response.json({ user, csrfToken });
  }));

  app.post("/api/auth/logout", requireUser, protectMutation, asyncRoute((request, response) => {
    if (request.sessionHash) db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(request.sessionHash);
    clearSessionCookie(response);
    response.status(204).end();
  }));

  app.post("/api/auth/change-password", requireUser, protectMutation, asyncRoute(async (request, response) => {
    const input = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12).max(128)
        .regex(/[a-z]/, "Include a lowercase letter.")
        .regex(/[A-Z]/, "Include an uppercase letter.")
        .regex(/\d/, "Include a number.")
        .regex(/[^A-Za-z0-9]/, "Include a symbol."),
      confirmPassword: z.string(),
    }).refine((value) => value.newPassword === value.confirmPassword, { message: "New passwords do not match.", path: ["confirmPassword"] }).parse(request.body);
    const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(request.user!.id) as { password_hash: string };
    if (!(await argon2.verify(user.password_hash, input.currentPassword))) throw new ApiError(400, "The current password is incorrect.");
    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    const update = db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(passwordHash, request.user!.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(request.user!.id, request.sessionHash);
    });
    update();
    response.json({ message: "Password changed successfully." });
  }));

  app.patch("/api/auth/profile", requireUser, protectMutation, upload.single("avatar"), asyncRoute(async (request, response) => {
    const input = z.object({ displayName: z.string().trim().min(2).max(80), removeAvatar: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).optional().default(false) }).parse(request.body);
    const previous = db.prepare("SELECT avatar_path FROM users WHERE id = ?").get(request.user!.id) as { avatar_path: string | null } | undefined;
    const avatar = request.file ? await saveAvatarImage(context, request.user!.id, request.file) : null;
    try {
      const update = db.transaction(() => {
        db.prepare("UPDATE users SET display_name = ?, avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(input.displayName, avatar ? avatar.storagePath : input.removeAvatar ? null : previous?.avatar_path ?? null, request.user!.id);
      });
      update();
      if (avatar || input.removeAvatar) await safeUnlink(previous?.avatar_path);
    } catch (error) {
      await safeUnlink(avatar?.storagePath);
      throw error;
    }
    const updated = db.prepare("SELECT id, email, display_name, role, avatar_path FROM users WHERE id = ?").get(request.user!.id) as { id: string; email: string; display_name: string; role: UserRole; avatar_path: string | null };
    response.json({ id: updated.id, email: updated.email, displayName: updated.display_name, role: updated.role, avatarUrl: updated.avatar_path ? `/uploads/avatars/${path.basename(updated.avatar_path)}` : null });
  }));

  app.get("/api/app-data", requireUser, asyncRoute((_request, response) => { response.json(appData(db)); }));

  app.post("/api/categories", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(50) }).parse(request.body);
    const id = randomUUID();
    db.prepare("INSERT INTO categories(id, name) VALUES (?, ?)").run(id, input.name);
    response.status(201).json({ id, name: input.name });
  }));

  app.patch("/api/categories/:id", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(50) }).parse(request.body);
    const result = db.prepare("UPDATE categories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.name, request.params.id);
    if (!result.changes) throw new ApiError(404, "Category not found.");
    response.json({ id: request.params.id, name: input.name });
  }));

  app.delete("/api/categories/:id", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const used = db.prepare("SELECT 1 FROM products WHERE category_id = ? LIMIT 1").get(request.params.id);
    if (used) throw new ApiError(409, "Move or delete this category's products first.");
    const result = db.prepare("DELETE FROM categories WHERE id = ?").run(request.params.id);
    if (!result.changes) throw new ApiError(404, "Category not found.");
    response.status(204).end();
  }));

  app.post("/api/products", requireRole("admin"), protectMutation, upload.single("image"), asyncRoute(async (request, response) => {
    const input = productFields.parse(request.body);
    const id = randomUUID();
    const image = request.file ? await saveProductImage(context, id, request.file) : null;
    try {
      const insert = db.transaction(() => {
        db.prepare(`INSERT INTO products(id, name, category_id, unit, current_stock, low_stock_threshold, price_centavos)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, input.name, input.categoryId, input.unit, roundQuantity(input.currentStock), roundQuantity(input.lowStockThreshold), Math.round(input.price * 100));
        if (image) db.prepare(`INSERT INTO product_images(id, product_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), id, image.storagePath, image.originalName, image.mimeType, image.sizeBytes, request.user!.id);
        syncInventoryAlert(db, id);
      });
      insert();
    } catch (error) {
      await safeUnlink(image?.storagePath);
      throw error;
    }
    response.status(201).json(mapProduct(getProductRow(db, id)!));
  }));

  app.patch("/api/products/:id", requireRole("admin"), protectMutation, upload.single("image"), asyncRoute(async (request, response) => {
    const existing = getProductRow(db, String(request.params.id ?? ""));
    if (!existing) throw new ApiError(404, "Product not found.");
    const input = productFields.parse(request.body);
    const previousImage = db.prepare("SELECT storage_path FROM product_images WHERE product_id = ?").get(existing.id) as { storage_path: string } | undefined;
    const image = request.file ? await saveProductImage(context, existing.id, request.file) : null;
    try {
      const update = db.transaction(() => {
        db.prepare(`UPDATE products SET name = ?, category_id = ?, unit = ?, current_stock = ?, low_stock_threshold = ?, price_centavos = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(input.name, input.categoryId, input.unit, roundQuantity(input.currentStock), roundQuantity(input.lowStockThreshold), Math.round(input.price * 100), existing.id);
        if (image || input.removeImage) db.prepare("DELETE FROM product_images WHERE product_id = ?").run(existing.id);
        if (image) db.prepare(`INSERT INTO product_images(id, product_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), existing.id, image.storagePath, image.originalName, image.mimeType, image.sizeBytes, request.user!.id);
        syncInventoryAlert(db, existing.id);
      });
      update();
      if (image || input.removeImage) await safeUnlink(previousImage?.storage_path);
    } catch (error) {
      await safeUnlink(image?.storagePath);
      throw error;
    }
    response.json(mapProduct(getProductRow(db, existing.id)!));
  }));

  app.delete("/api/products/:id", requireRole("admin"), protectMutation, asyncRoute(async (request, response) => {
    const references = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM sale_items WHERE product_id = ?) OR
      EXISTS(SELECT 1 FROM inventory_movements WHERE product_id = ?) AS used`).get(request.params.id, request.params.id) as { used: number };
    if (references.used) throw new ApiError(409, "Products with sales or inventory history cannot be deleted.");
    const image = db.prepare("SELECT storage_path FROM product_images WHERE product_id = ?").get(request.params.id) as { storage_path: string } | undefined;
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(request.params.id);
    if (!result.changes) throw new ApiError(404, "Product not found.");
    await safeUnlink(image?.storage_path);
    response.status(204).end();
  }));

  app.post("/api/inventory", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ productId: z.string().uuid(), quantity: z.number().positive().max(1_000_000), date: dateSchema, note: z.string().trim().max(160).default("") }).parse(request.body);
    const id = randomUUID();
    const transaction = db.transaction(() => {
      const product = db.prepare("SELECT current_stock FROM products WHERE id = ?").get(input.productId) as { current_stock: number } | undefined;
      if (!product) throw new ApiError(404, "Product not found.");
      db.prepare("INSERT INTO inventory_movements(id, product_id, quantity, note, movement_date, created_by) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.productId, roundQuantity(input.quantity), input.note, input.date, request.user!.id);
      db.prepare("UPDATE products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(roundQuantity(product.current_stock + input.quantity), input.productId);
      syncInventoryAlert(db, input.productId);
    });
    transaction();
    response.status(201).json({ id });
  }));

  app.patch("/api/inventory/:id", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ quantity: z.number().positive().max(1_000_000), date: dateSchema, note: z.string().trim().max(160).default("") }).parse(request.body);
    const transaction = db.transaction(() => {
      const movement = db.prepare("SELECT product_id, quantity FROM inventory_movements WHERE id = ?").get(request.params.id) as { product_id: string; quantity: number } | undefined;
      if (!movement) throw new ApiError(404, "Inventory entry not found.");
      const product = db.prepare("SELECT current_stock FROM products WHERE id = ?").get(movement.product_id) as { current_stock: number };
      const next = roundQuantity(product.current_stock - movement.quantity + input.quantity);
      if (next < 0) throw new ApiError(409, "This edit would make current stock negative.");
      db.prepare("UPDATE inventory_movements SET quantity = ?, movement_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(roundQuantity(input.quantity), input.date, input.note, request.params.id);
      db.prepare("UPDATE products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(next, movement.product_id);
      syncInventoryAlert(db, movement.product_id);
    });
    transaction();
    response.json({ id: request.params.id });
  }));

  app.delete("/api/inventory/:id", requireRole("admin"), protectMutation, asyncRoute((request, response) => {
    const transaction = db.transaction(() => {
      const movement = db.prepare("SELECT product_id, quantity FROM inventory_movements WHERE id = ?").get(request.params.id) as { product_id: string; quantity: number } | undefined;
      if (!movement) throw new ApiError(404, "Inventory entry not found.");
      const product = db.prepare("SELECT current_stock FROM products WHERE id = ?").get(movement.product_id) as { current_stock: number };
      if (product.current_stock - movement.quantity < 0) throw new ApiError(409, "This entry cannot be deleted because some of its stock has already been used.");
      db.prepare("DELETE FROM inventory_movements WHERE id = ?").run(request.params.id);
      db.prepare("UPDATE products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(roundQuantity(product.current_stock - movement.quantity), movement.product_id);
      syncInventoryAlert(db, movement.product_id);
    });
    transaction();
    response.status(204).end();
  }));

  app.post("/api/sales", requireRole("staff", "admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ payment: paymentSchema, items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(999) })).min(1) }).parse(request.body);
    const id = randomUUID();
    const receipt = `RC-${getBusinessDate().slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    let totalCentavos = 0;
    const transaction = db.transaction(() => {
      const itemRows = input.items.map((item) => {
        const product = db.prepare("SELECT id, name, price_centavos, current_stock FROM products WHERE id = ? AND active = 1").get(item.productId) as { id: string; name: string; price_centavos: number; current_stock: number } | undefined;
        if (!product) throw new ApiError(404, "A product in this order is no longer available.");
        if (product.current_stock < item.quantity) throw new ApiError(409, `${product.name} only has ${product.current_stock} remaining.`);
        const lineTotal = product.price_centavos * item.quantity;
        totalCentavos += lineTotal;
        return { ...item, product, lineTotal };
      });
      db.prepare(`INSERT INTO sales(id, receipt, business_date, payment_method, total_centavos, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, receipt, getBusinessDate(), input.payment, totalCentavos, request.user!.id);
      const insertItem = db.prepare(`INSERT INTO sale_items(id, sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const decrease = db.prepare("UPDATE products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      itemRows.forEach((item) => {
        insertItem.run(randomUUID(), id, item.product.id, item.product.name, item.quantity, item.product.price_centavos, item.lineTotal);
        decrease.run(roundQuantity(item.product.current_stock - item.quantity), item.product.id);
        syncInventoryAlert(db, item.product.id);
      });
    });
    transaction();
    response.status(201).json({ id, receipt, date: getBusinessDate(), payment: input.payment, status: "Completed", total: totalCentavos / 100 });
  }));

  app.patch("/api/sales/:id/status", requireRole("staff", "admin"), protectMutation, asyncRoute((request, response) => {
    const input = z.object({ status: z.enum(["Completed", "Cancelled"]) }).parse(request.body);
    const transaction = db.transaction(() => {
      const sale = db.prepare("SELECT status FROM sales WHERE id = ?").get(request.params.id) as { status: string } | undefined;
      if (!sale) throw new ApiError(404, "Sale not found.");
      if (sale.status === input.status) return;
      const items = db.prepare("SELECT product_id, product_name, quantity FROM sale_items WHERE sale_id = ?").all(request.params.id) as Array<{ product_id: string; product_name: string; quantity: number }>;
      if (input.status === "Cancelled") {
        items.forEach((item) => {
          db.prepare("UPDATE products SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.quantity, item.product_id);
          syncInventoryAlert(db, item.product_id);
        });
        db.prepare("UPDATE sales SET status = 'Cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(request.user!.id, request.params.id);
      } else {
        items.forEach((item) => {
          const product = db.prepare("SELECT current_stock FROM products WHERE id = ?").get(item.product_id) as { current_stock: number };
          if (product.current_stock < item.quantity) throw new ApiError(409, `${item.product_name} does not have enough stock to restore this sale.`);
          db.prepare("UPDATE products SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.quantity, item.product_id);
          syncInventoryAlert(db, item.product_id);
        });
        db.prepare("UPDATE sales SET status = 'Completed', cancelled_by = NULL, cancelled_at = NULL WHERE id = ?").run(request.params.id);
      }
    });
    transaction();
    response.json({ id: request.params.id, status: input.status });
  }));

  app.get("/api/notifications", requireUser, asyncRoute((request, response) => {
    const rows = db.prepare(`
      SELECT n.id, n.type, n.severity, n.title, n.message, n.product_id AS productId,
             n.created_at AS createdAt, n.active, CASE WHEN nr.read_at IS NULL THEN 0 ELSE 1 END AS isRead
      FROM notifications n LEFT JOIN notification_reads nr
        ON nr.notification_id = n.id AND nr.user_id = ?
      ORDER BY n.active DESC, n.created_at DESC LIMIT 100
    `).all(request.user!.id);
    const unread = (rows as Array<{ isRead: number; active: number }>).filter((row) => !row.isRead && row.active).length;
    response.json({ notifications: rows, unread });
  }));

  app.patch("/api/notifications/:id/read", requireUser, protectMutation, asyncRoute((request, response) => {
    const exists = db.prepare("SELECT 1 FROM notifications WHERE id = ?").get(request.params.id);
    if (!exists) throw new ApiError(404, "Notification not found.");
    db.prepare("INSERT OR REPLACE INTO notification_reads(notification_id, user_id, read_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
      .run(request.params.id, request.user!.id);
    response.status(204).end();
  }));

  app.post("/api/notifications/read-all", requireUser, protectMutation, asyncRoute((request, response) => {
    db.prepare(`INSERT OR REPLACE INTO notification_reads(notification_id, user_id, read_at)
      SELECT id, ?, CURRENT_TIMESTAMP FROM notifications WHERE active = 1`).run(request.user!.id);
    response.status(204).end();
  }));

  app.get("/api/reports/sales", requireRole("admin"), asyncRoute((request, response) => {
    const range = z.object({ from: dateSchema, to: dateSchema }).refine((value) => value.from <= value.to, { message: "Start date must be on or before end date." }).parse(request.query);
    response.json(buildSalesReport(db, range));
  }));
  app.get("/api/reports/sales.csv", requireRole("admin"), asyncRoute((request, response) => {
    const range = z.object({ from: dateSchema, to: dateSchema }).parse(request.query);
    const report = buildSalesReport(db, range);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename=halara-sales-${range.from}-to-${range.to}.csv`);
    response.send(reportCsv(report));
  }));
  app.get("/api/reports/sales.pdf", requireRole("admin"), asyncRoute((request, response) => {
    const range = z.object({ from: dateSchema, to: dateSchema }).parse(request.query);
    const report = buildSalesReport(db, range);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename=halara-sales-${range.from}-to-${range.to}.pdf`);
    streamReportPdf(response, report);
  }));

  if (options.serveFrontend !== false) {
    const distPath = path.resolve(process.cwd(), "dist");
    try {
      await access(distPath);
      app.use(express.static(distPath));
      app.get(/.*/, (_request, response) => response.sendFile(path.join(distPath, "index.html")));
    } catch { /* The Vite development server serves the frontend. */ }
  }

  if (!options.skipNotFound) {
    app.use((_request: Request, response: Response) => response.status(404).json({ error: "Not found." }));
  }
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof ZodError) { response.status(400).json({ error: error.issues[0]?.message ?? "Invalid request." }); return; }
    if (error instanceof multer.MulterError) { response.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Images must be 5 MB or smaller." : error.message }); return; }
    const sqlite = error as { code?: string; message?: string };
    if (sqlite.code?.startsWith("SQLITE_CONSTRAINT")) {
      const message = sqlite.message?.includes("categories.name") ? "A category with this name already exists."
        : sqlite.message?.includes("products.name") ? "A product with this name already exists."
        : "This record conflicts with existing data.";
      response.status(409).json({ error: message }); return;
    }
    console.error(error);
    response.status(500).json({ error: "An unexpected server error occurred." });
  });

  return { app, context };
}
