import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, role: "admin" | "staff") {
  await page.goto("/");
  await page.locator(`[data-role="${role}"]`).click();
  await page.locator('[name="email"]').fill(`${role}@halara.test`);
  await page.locator('[name="password"]').fill(role === "admin" ? "Admin@12345!" : "Staff@12345!");
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function tabletAdminNavigate(page: import("@playwright/test").Page, route: string) {
  await page.locator("#open-nav").click();
  await page.locator(`.sidebar [data-route="${route}"]`).click();
}

test("desktop role selection and tablet Admin operations remain responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose how you want to sign in" })).toBeVisible();
  await expect(page.locator('[data-role="admin"]')).toBeVisible();
  await expect(page.locator('[data-role="staff"]')).toBeVisible();

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.locator('[data-role="admin"]').click();
  await page.locator('[name="email"]').fill("admin@halara.test");
  await page.locator('[name="password"]').fill("Admin@12345!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Business at a glance" })).toBeVisible();

  await tabletAdminNavigate(page, "products");
  await page.locator('[data-product-tab="categories"]').click();
  await page.locator('[data-action="add-category"]').click();
  await page.locator('#dialog-form [name="name"]').fill("Beverages");
  await page.getByRole("button", { name: "Add category", exact: true }).last().click();
  await expect(page.getByText("Beverages", { exact: true })).toBeVisible();

  await page.locator('[data-product-tab="products"]').click();
  await page.locator('[data-action="add-product"]').click();
  const dialog = page.locator("#dialog-form");
  await dialog.locator('[name="name"]').fill("Iced Latte");
  await dialog.locator('[name="currentStock"]').fill("2");
  await dialog.locator('[name="lowStockThreshold"]').fill("5");
  await dialog.locator('[name="price"]').fill("120");
  await page.getByRole("button", { name: "Add product", exact: true }).last().click();
  await expect(page.getByText("Iced Latte", { exact: true })).toBeVisible();

  await page.locator('[data-action="notifications"]').click();
  await expect(page.locator(".notification-popover")).toBeVisible();
  await expect(page.getByText("Iced Latte is running low")).toBeVisible();
  await page.locator('[data-action="close-notifications"]').click();

  await tabletAdminNavigate(page, "reports");
  await expect(page.getByRole("heading", { name: "Sales report", exact: true })).toBeVisible();
  await page.locator('[data-action="generate-report"]').click();
  await expect(page.getByText("PDF report")).toBeVisible();
  await expect(page.getByText("CSV export")).toBeVisible();
  await page.locator(".modal-close").click();

  await tabletAdminNavigate(page, "settings");
  await expect(page.getByRole("heading", { name: "Account & Settings" })).toBeVisible();
  await expect(page.locator("#admin-password-form")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("mobile Staff POS uses separate product, cart, and payment pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "staff");
  await expect(page.getByRole("heading", { name: "Today’s overview" })).toBeVisible();
  await page.locator('[data-staff-view="products"]').first().click();
  await expect(page.getByRole("heading", { name: "New order" })).toBeVisible();
  await page.locator('[data-action="add-cart"]').click();
  await page.locator('[data-staff-view="cart"]').click();
  await expect(page.getByRole("heading", { name: "Review items" })).toBeVisible();
  await page.getByRole("button", { name: "Proceed to payment" }).click();
  await expect(page.getByRole("heading", { name: "Select payment method" })).toBeVisible();
  await page.locator('[data-payment="Cash"]').click();
  await expect(page.locator('[data-action="confirm-payment"]')).toBeEnabled();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
