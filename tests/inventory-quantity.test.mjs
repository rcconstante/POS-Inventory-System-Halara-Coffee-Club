import assert from "node:assert/strict";
import test from "node:test";
import {
  stockUnits,
  stockQuantity,
  stockAfterDelivery,
} from "../src/inventory-quantity.ts";

test("five kilograms is saved as exactly five thousand grams", () => {
  const kilograms = stockUnits("g").find((unit) => unit.unit === "kg");
  assert.equal(stockQuantity("5", kilograms.factor), 5000);
  assert.equal(stockQuantity("5000"), 5000);
  assert.equal(stockAfterDelivery(82, 5000), 5082);
});

test("delivery conversion supports volume, kilogram base units and count units", () => {
  assert.equal(
    stockQuantity(
      "5",
      stockUnits("mL").find((unit) => unit.unit === "L").factor,
    ),
    5000,
  );
  assert.equal(
    stockQuantity(
      "5000",
      stockUnits("kg").find((unit) => unit.unit === "g").factor,
    ),
    5,
  );
  assert.deepEqual(stockUnits("pcs"), [{ unit: "pcs", factor: 1 }]);
});

test("editing a delivery preserves prior consumption rather than resetting stock", () => {
  assert.equal(stockAfterDelivery(4820, 6000, 5000), 5820);
  assert.equal(stockAfterDelivery(4820, 5000, 5000), 4820);
  assert.equal(stockAfterDelivery(10, 100, 5000), -4890);
});

test("invalid, non-finite, zero and unrepresentable quantities are rejected", () => {
  for (const value of [
    "",
    "5k",
    "5,000",
    "NaN",
    "Infinity",
    "-5",
    "0",
    ".0001",
  ])
    assert.throws(() => stockQuantity(value));
  assert.throws(() => stockQuantity("5", NaN));
  assert.equal(stockQuantity("0.000001", 1000), 0.001);
  assert.equal(stockQuantity(".125"), 0.125);
});
