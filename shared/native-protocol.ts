export const POS_ORIGIN = "https://halara-coffee-club.netlify.app";
export const BRIDGE_VERSION = 1;

export interface NativeReceipt {
  receipt: string;
  status: "Completed" | "Cancelled";
  dateTime: string;
  cashier: string;
  payment: "Cash" | "GCash" | "Maya";
  totalCentavos: number;
  cashReceivedCentavos: number | null;
  changeCentavos: number | null;
  items: Array<{ name: string; quantity: number; unitPriceCentavos: number }>;
}

export type NativeRequest = { version: 1; id: string } & (
  | { action: "print"; receipt: NativeReceipt }
  | { action: "select-printer" }
);

export interface NativeResponse {
  version: 1;
  id: string;
  success: boolean;
  message: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
}

export function isNativeReceipt(value: unknown): value is NativeReceipt {
  if (!record(value) || !text(value.receipt, 80) || !text(value.dateTime, 100) || !text(value.cashier, 200)) return false;
  if (value.status !== "Completed" && value.status !== "Cancelled") return false;
  if (value.payment !== "Cash" && value.payment !== "GCash" && value.payment !== "Maya") return false;
  if (!amount(value.totalCentavos) || !Array.isArray(value.items) || !value.items.length || value.items.length > 250) return false;
  let total = 0;
  for (const item of value.items) {
    if (!record(item) || !text(item.name, 300) || !amount(item.unitPriceCentavos)) return false;
    if (typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100_000) return false;
    total += item.quantity * item.unitPriceCentavos;
  }
  if (!Number.isSafeInteger(total) || total !== value.totalCentavos) return false;
  if (value.payment === "Cash") {
    if (!amount(value.cashReceivedCentavos) || !amount(value.changeCentavos)) return false;
    if (value.cashReceivedCentavos - value.totalCentavos !== value.changeCentavos) return false;
  } else if (value.cashReceivedCentavos !== null || value.changeCentavos !== null) return false;
  return true;
}

export function parseNativeRequest(raw: string): NativeRequest {
  if (raw.length > 100_000) throw new Error("The printer request is too large.");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== BRIDGE_VERSION || !text(value.id, 80) || !/^[a-zA-Z0-9-]+$/.test(value.id)) {
    throw new Error("Invalid printer request.");
  }
  if (value.action === "select-printer") return { version: 1, id: value.id, action: value.action };
  if (value.action === "print" && isNativeReceipt(value.receipt)) {
    return { version: 1, id: value.id, action: value.action, receipt: value.receipt };
  }
  throw new Error("Invalid receipt data.");
}

export function isTrustedPosUrl(value: string): boolean {
  try { return new URL(value).origin === POS_ORIGIN; } catch { return false; }
}
