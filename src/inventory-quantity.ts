export interface StockUnit {
  unit: string;
  factor: number;
}

export function stockUnits(base: string): StockUnit[] {
  switch (base.trim().toLowerCase()) {
    case "g":
      return [
        { unit: base, factor: 1 },
        { unit: "kg", factor: 1000 },
      ];
    case "kg":
      return [
        { unit: base, factor: 1 },
        { unit: "g", factor: 0.001 },
      ];
    case "ml":
      return [
        { unit: base, factor: 1 },
        { unit: "L", factor: 1000 },
      ];
    case "l":
      return [
        { unit: base, factor: 1 },
        { unit: "mL", factor: 0.001 },
      ];
    default:
      return [{ unit: base, factor: 1 }];
  }
}

export function stockQuantity(input: string, factor = 1): number {
  const trimmed = input.trim();
  if (!trimmed || !Number.isFinite(factor) || factor <= 0)
    throw new Error("Enter a valid quantity and unit.");
  if (
    trimmed.includes(",") &&
    !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)
  )
    throw new Error("Enter a valid quantity and unit.");
  const value = Number(trimmed.replace(/,/g, "")) * factor;
  const rounded = Math.round(value * 1000) / 1000;
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 999_999_999_999.999 ||
    rounded < 0.001
  )
    throw new Error("Quantity must be at least 0.001 in the inventory unit.");
  if (
    Math.abs(value - rounded) >
    Math.max(1e-9, Math.abs(value) * Number.EPSILON * 2)
  )
    throw new Error(
      "Quantity supports up to three decimals in the inventory unit.",
    );
  return rounded;
}

export function stockAfterDelivery(
  current: number,
  quantity: number,
  original = 0,
): number {
  return Math.round((current + quantity - original) * 1000) / 1000;
}
