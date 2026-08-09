import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request, { type Agent } from "supertest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./index.js";
import type { DatabaseContext } from "./db.js";
import type { Express } from "express";

describe("Halara local API", () => {
  let dataDir = "";
  let app: Express;
  let context: DatabaseContext;
  let admin: Agent;
  let staff: Agent;
  let adminCsrf = "";
  let staffCsrf = "";
  let categoryId = "";
  let productId = "";
  let movementId = "";
  let saleId = "";

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "halara-api-"));
    const created = await createApp({ dataDir, serveFrontend: false });
    app = created.app;
    context = created.context;
    admin = request.agent(app);
    staff = request.agent(app);
  });

  afterAll(async () => {
    context.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects incorrect credentials and authenticates seeded role accounts", async () => {
    await request(app).post("/api/auth/login").send({ role: "admin", email: "admin@halara.test", password: "wrong" }).expect(401);
    const adminLogin = await admin.post("/api/auth/login").send({ role: "admin", email: "admin@halara.test", password: "Admin@12345!" }).expect(200);
    adminCsrf = adminLogin.body.csrfToken as string;
    expect(adminLogin.body.user.role).toBe("admin");
    const staffLogin = await staff.post("/api/auth/login").send({ role: "staff", email: "staff@halara.test", password: "Staff@12345!" }).expect(200);
    staffCsrf = staffLogin.body.csrfToken as string;
    expect(staffLogin.body.user.role).toBe("staff");
  });

  it("enforces CSRF and role authorization", async () => {
    await admin.post("/api/categories").send({ name: "Coffee" }).expect(403);
    await staff.post("/api/categories").set("x-csrf-token", staffCsrf).send({ name: "Coffee" }).expect(403);
  });

  it("creates persistent catalog data and a validated product image", async () => {
    const category = await admin.post("/api/categories").set("x-csrf-token", adminCsrf).send({ name: "Beverages" }).expect(201);
    categoryId = category.body.id as string;
    const png = await readFile(path.resolve(process.cwd(), "assets", "Logo.png"));
    const product = await admin.post("/api/products").set("x-csrf-token", adminCsrf)
      .field("name", "Iced Latte").field("categoryId", categoryId).field("unit", "cups")
      .field("currentStock", "0").field("lowStockThreshold", "5").field("price", "120")
      .field("removeImage", "false").attach("image", png, { filename: "latte.png", contentType: "image/png" }).expect(201);
    productId = product.body.id as string;
    expect(product.body.imageUrl).toMatch(/^\/uploads\/products\/.+\.webp$/);
    const data = await admin.get("/api/app-data").expect(200);
    expect(data.body.categories).toHaveLength(1);
    expect(data.body.products[0].price).toBe(120);
  });

  it("records inventory and deduplicates a recovered stock alert", async () => {
    const initial = await admin.get("/api/notifications").expect(200);
    expect(initial.body.unread).toBe(1);
    const movement = await admin.post("/api/inventory").set("x-csrf-token", adminCsrf)
      .send({ productId, quantity: 10, date: "2026-08-09", note: "Opening delivery" }).expect(201);
    movementId = movement.body.id as string;
    const resolved = await admin.get("/api/notifications").expect(200);
    expect(resolved.body.notifications[0].active).toBe(0);
  });

  it("creates a staff sale transaction, updates stock, and supports refund", async () => {
    const sale = await staff.post("/api/sales").set("x-csrf-token", staffCsrf)
      .send({ payment: "GCash", items: [{ productId, quantity: 2 }] }).expect(201);
    saleId = sale.body.id as string;
    expect(sale.body.total).toBe(240);
    let data = await staff.get("/api/app-data").expect(200);
    expect(data.body.products[0].currentStock).toBe(8);
    await staff.patch(`/api/sales/${saleId}/status`).set("x-csrf-token", staffCsrf).send({ status: "Cancelled" }).expect(200);
    data = await staff.get("/api/app-data").expect(200);
    expect(data.body.products[0].currentStock).toBe(10);
  });

  it("generates SQL-backed JSON, CSV, and PDF reports", async () => {
    await staff.patch(`/api/sales/${saleId}/status`).set("x-csrf-token", staffCsrf).send({ status: "Completed" }).expect(200);
    const report = await admin.get("/api/reports/sales?from=2026-08-01&to=2026-08-31").expect(200);
    expect(report.body.summary.totalSalesCentavos).toBe(24000);
    expect(report.body.topProducts[0].name).toBe("Iced Latte");
    await admin.get("/api/reports/sales.csv?from=2026-08-01&to=2026-08-31").expect("content-type", /text\/csv/).expect(200);
    const pdf = await admin.get("/api/reports/sales.pdf?from=2026-08-01&to=2026-08-31").buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    }).expect("content-type", /application\/pdf/).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("changes passwords, rejects the old password, and preserves SQL data", async () => {
    const avatar = await readFile(path.resolve(process.cwd(), "assets", "Logo.png"));
    const profile = await admin.patch("/api/auth/profile").set("x-csrf-token", adminCsrf)
      .field("displayName", "Updated Admin")
      .field("removeAvatar", "false")
      .attach("avatar", avatar, { filename: "profile.png", contentType: "image/png" }).expect(200);
    expect(profile.body.displayName).toBe("Updated Admin");
    expect(profile.body.avatarUrl).toMatch(/^\/uploads\/avatars\/.+\.webp$/);
    await admin.post("/api/auth/change-password").set("x-csrf-token", adminCsrf)
      .send({ currentPassword: "Admin@12345!", newPassword: "Updated@12345!", confirmPassword: "Updated@12345!" }).expect(200);
    await request(app).post("/api/auth/login").send({ role: "admin", email: "admin@halara.test", password: "Admin@12345!" }).expect(401);
    await request(app).post("/api/auth/login").send({ role: "admin", email: "admin@halara.test", password: "Updated@12345!" }).expect(200);
    const stored = context.db.prepare("SELECT COUNT(*) AS count FROM products WHERE id = ?").get(productId) as { count: number };
    expect(stored.count).toBe(1);
    const movement = context.db.prepare("SELECT id FROM inventory_movements WHERE id = ?").get(movementId) as { id: string };
    expect(movement.id).toBe(movementId);
  });
});
