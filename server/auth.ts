import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";

export type UserRole = "admin" | "staff";

export interface UserSession {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl: string | null;
  csrfToken: string;
}

export interface AuthenticatedRequest extends Request {
  user?: UserSession;
  sessionHash?: string;
}

const COOKIE_NAME = "halara_session";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookies(request: Request): Record<string, string> {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((entry) => entry.length === 2)
      .map(([key, value]) => [decodeURIComponent(key ?? ""), decodeURIComponent(value ?? "")]),
  );
}

export function createSession(
  db: Database.Database,
  userId: string,
): { token: string; csrfToken: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const days = Math.max(1, Number(process.env.HALARA_SESSION_DAYS ?? 7));
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  db.prepare(
    "INSERT INTO sessions(id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
  ).run(digest(token), userId, csrfToken, expiresAt);
  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(response: Response, token: string, expiresAt: string): void {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expiresAt),
    path: "/",
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(COOKIE_NAME, { path: "/", sameSite: "lax" });
}

export function sessionMiddleware(db: Database.Database) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction): void => {
    const token = cookies(request)[COOKIE_NAME];
    if (!token) {
      next();
      return;
    }
    const sessionHash = digest(token);
    const row = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.role, u.avatar_path, s.csrf_token
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ? AND u.active = 1
    `).get(sessionHash, new Date().toISOString()) as
      | { id: string; email: string; display_name: string; role: UserRole; avatar_path: string | null; csrf_token: string }
      | undefined;
    if (row) {
      request.sessionHash = sessionHash;
      request.user = {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        avatarUrl: row.avatar_path ? `/uploads/avatars/${row.avatar_path.split(/[\\/]/).pop()}` : null,
        csrfToken: row.csrf_token,
      };
    }
    next();
  };
}

export function requireUser(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  if (!request.user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export function protectMutation(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  if (!request.user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }
  if (request.headers["x-csrf-token"] !== request.user.csrfToken) {
    response.status(403).json({ error: "Your secure session token is missing or expired." });
    return;
  }
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) {
        response.status(403).json({ error: "Cross-origin request rejected." });
        return;
      }
    } catch {
      response.status(403).json({ error: "Invalid request origin." });
      return;
    }
  }
  next();
}
