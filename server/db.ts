import Database from "better-sqlite3";
import argon2 from "argon2";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface DatabaseContext {
  db: Database.Database;
  dataDir: string;
  uploadsDir: string;
  avatarsDir: string;
  close: () => void;
}

export async function createDatabase(dataDirectory?: string): Promise<DatabaseContext> {
  const dataDir = path.resolve(dataDirectory ?? process.env.HALARA_DATA_DIR ?? "data");
  const uploadsDir = path.join(dataDir, "uploads", "products");
  const avatarsDir = path.join(dataDir, "uploads", "avatars");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(avatarsDir, { recursive: true });
  const db = new Database(path.join(dataDir, "halara.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const migrationPath = path.resolve(process.cwd(), "server", "sql", "001_initial.sql");
  db.exec(await readFile(migrationPath, "utf8"));
  const profileMigrationPath = path.resolve(process.cwd(), "server", "sql", "002_profile.sql");
  const hasAvatarColumn = db.prepare("PRAGMA table_info(users)").all().some((column) => (column as { name?: string }).name === "avatar_path");
  if (!hasAvatarColumn) db.exec(await readFile(profileMigrationPath, "utf8"));
  const hasContributorMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE version = 3").get();
  if (!hasContributorMigration) db.exec(await readFile(path.resolve(process.cwd(), "server", "sql", "003_contributor_identity.sql"), "utf8"));
  await seedDemoUsers(db);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());

  return { db, dataDir, uploadsDir, avatarsDir, close: () => db.close() };
}

async function seedDemoUsers(db: Database.Database): Promise<void> {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users(id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `);
  const adminHash = await argon2.hash("Admin@12345!", { type: argon2.argon2id });
  const staffHash = await argon2.hash("Staff@12345!", { type: argon2.argon2id });
  const seed = db.transaction(() => {
    insert.run(randomUUID(), "r.constante.dev@gmail.com", "Richmond Constante", "admin", adminHash);
    insert.run(randomUUID(), "staff@halara.test", "Thesis Staff", "staff", staffHash);
  });
  seed();
}

export function getBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
