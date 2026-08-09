export type UserRole = "admin" | "staff";
export type PaymentMethod = "Cash" | "GCash" | "Maya";
export type SaleStatus = "Completed" | "Cancelled";

export interface UserSession {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl: string | null;
}

export interface Category { id: string; name: string }

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  price: number;
  imageUrl: string | null;
}

export interface StockMovement {
  id: string;
  productId: string;
  quantity: number;
  date: string;
  note: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Sale {
  id: string;
  receipt: string;
  date: string;
  payment: PaymentMethod;
  status: SaleStatus;
  total: number;
  items: SaleItem[];
  createdAt: string;
}

export interface AppData {
  categories: Category[];
  products: Product[];
  stockMovements: StockMovement[];
  sales: Sale[];
}

export interface NotificationItem {
  id: string;
  type: "low_stock" | "out_of_stock";
  severity: "warning" | "danger";
  title: string;
  message: string;
  productId: string;
  createdAt: string;
  active: number;
  isRead: number;
}

export interface ReportSummary {
  range: { from: string; to: string };
  summary: { totalSalesCentavos: number; totalTransactions: number; averageSaleCentavos: number };
  daily: Array<{ date: string; totalCentavos: number }>;
  topProducts: Array<{ name: string; quantity: number; totalCentavos: number }>;
  payments: Array<{ method: string; transactions: number; totalCentavos: number }>;
  transactions: Array<{ receipt: string; date: string; payment: string; status: string; totalCentavos: number; items: string }>;
}

let csrfToken = "";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("x-csrf-token", csrfToken);
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = String((await response.json() as { error?: string }).error ?? message); } catch { /* Non-JSON error. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  async session(): Promise<UserSession> {
    const result = await request<{ user: UserSession; csrfToken: string }>("/api/auth/session");
    csrfToken = result.csrfToken;
    return result.user;
  },
  async login(role: UserRole, email: string, password: string): Promise<UserSession> {
    const result = await request<{ user: UserSession; csrfToken: string }>("/api/auth/login", {
      method: "POST", body: JSON.stringify({ role, email, password }),
    });
    csrfToken = result.csrfToken;
    return result.user;
  },
  async logout(): Promise<void> {
    await request<void>("/api/auth/logout", { method: "POST" });
    csrfToken = "";
  },
  changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    return request<{ message: string }>("/api/auth/change-password", {
      method: "POST", body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
  },
  updateProfile: (data: FormData) => request<UserSession>("/api/auth/profile", { method: "PATCH", body: data }),
  appData: () => request<AppData>("/api/app-data"),
  createCategory: (name: string) => request<Category>("/api/categories", { method: "POST", body: JSON.stringify({ name }) }),
  updateCategory: (id: string, name: string) => request<Category>(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: "DELETE" }),
  createProduct: (data: FormData) => request<Product>("/api/products", { method: "POST", body: data }),
  updateProduct: (id: string, data: FormData) => request<Product>(`/api/products/${id}`, { method: "PATCH", body: data }),
  deleteProduct: (id: string) => request<void>(`/api/products/${id}`, { method: "DELETE" }),
  createStock: (body: { productId: string; quantity: number; date: string; note: string }) =>
    request<{ id: string }>("/api/inventory", { method: "POST", body: JSON.stringify(body) }),
  updateStock: (id: string, body: { quantity: number; date: string; note: string }) =>
    request<{ id: string }>(`/api/inventory/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStock: (id: string) => request<void>(`/api/inventory/${id}`, { method: "DELETE" }),
  createSale: (payment: PaymentMethod, items: Array<{ productId: string; quantity: number }>) =>
    request<{ id: string; receipt: string; total: number }>("/api/sales", { method: "POST", body: JSON.stringify({ payment, items }) }),
  updateSaleStatus: (id: string, status: SaleStatus) =>
    request<{ id: string; status: SaleStatus }>(`/api/sales/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  notifications: () => request<{ notifications: NotificationItem[]; unread: number }>("/api/notifications"),
  readNotification: (id: string) => request<void>(`/api/notifications/${id}/read`, { method: "PATCH" }),
  readAllNotifications: () => request<void>("/api/notifications/read-all", { method: "POST" }),
  report: (from: string, to: string) => request<ReportSummary>(`/api/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  async downloadReport(format: "pdf" | "csv", from: string, to: string): Promise<void> {
    const response = await fetch(`/api/reports/sales.${format}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Report generation failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename=([^;]+)/)?.[1] ?? `sales-report.${format}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  },
};
