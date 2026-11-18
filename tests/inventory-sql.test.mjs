import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";
test("inventory SQL preserves deliveries, units and sale/refund snapshots", async () => {
  const db = new PGlite();
  const sql = readFileSync(
    "supabase/migrations/006_cash_reporting_realtime.sql",
    "utf8",
  );
  const results = [];
  try {
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$; create function public.is_admin() returns boolean language sql as $$select true$$;
 create table products(id uuid primary key, product_type text not null,active boolean default true,current_stock numeric(15,3) not null check(current_stock>=0),cost_baseline_quantity numeric(15,3) default 0,cost_baseline_total_centavos bigint default 0,average_unit_cost_centavos numeric(18,6) default 0,cost_initialized boolean default false,updated_at timestamptz default now());
 create table inventory_movements(id uuid primary key,product_id uuid references products,quantity numeric(15,3) not null check(quantity>0),note text,movement_date date,created_by uuid,total_cost_centavos bigint,unit_cost_centavos numeric(18,6),created_at timestamptz default now(),updated_at timestamptz default now());`);
    for (const name of [
      "recalculate_material_cost",
      "add_stock",
      "update_stock_entry",
      "delete_stock_entry",
    ]) {
      const expression = new RegExp(
        "create (?:or replace )?function public\\." +
          name +
          "\\([\\s\\S]*?\\$\\$;",
        "i",
      );
      const definition = sql.match(expression)?.[0];
      assert.ok(definition, name);
      await db.exec(definition);
    }
    const id = "22222222-2222-4222-8222-222222222222";
    await db.query(
      "insert into products(id,product_type,current_stock) values($1,'raw_material',100)",
      [id],
    );
    const stock = async () =>
      Number(
        (await db.query("select current_stock from products where id=$1", [id]))
          .rows[0].current_stock,
      );
    const added = (
      await db.query(
        "select add_stock($1,5000,'2026-11-18','Test',500000) as id",
        [id],
      )
    ).rows[0].id;
    assert.equal(await stock(), 5100);
    assert.equal(
      Number(
        (
          await db.query(
            "select quantity from inventory_movements where id=$1",
            [added],
          )
        ).rows[0].quantity,
      ),
      5000,
    );
    results.push(
      "Adding 5,000 g increases existing 100 g to 5,100 g and saves the full delivery quantity",
    );
    await db.query(
      "update products set current_stock=current_stock-18 where id=$1",
      [id],
    );
    assert.equal(await stock(), 5082);
    results.push(
      "An 18 g consumption leaves 5,082 g without changing the 5,000 g delivery entry",
    );
    await db.query(
      "select update_stock_entry($1,6000,'2026-11-18','Edited delivery',600000)",
      [added],
    );
    assert.equal(await stock(), 6082);
    results.push(
      "Editing that delivery from 5,000 to 6,000 adds only the 1,000 g difference, preserving prior consumption",
    );
    const before = await stock();
    await assert.rejects(
      db.query("select add_stock($1,0,'2026-11-18','Invalid',100)", [id]),
      /greater than zero/,
    );
    assert.equal(await stock(), before);
    results.push("Invalid quantities do not change the stock balance");
    await db.query("select add_stock($1,0.125,'2026-11-18','Fraction',100)", [
      id,
    ]);
    assert.equal(await stock(), 6082.125);
    results.push("Three-decimal gram quantities are preserved");
    await db.query("select delete_stock_entry($1)", [added]);
    assert.equal(await stock(), 82.125);
    results.push(
      "Deleting an unconsumed delivery subtracts that delivery, without resetting the remaining balance",
    );

    await db.exec(
      `alter table products add column unit text default 'g'; create table product_recipes(ingredient_id uuid,finished_product_id uuid);create table sale_items(product_id uuid);create table sale_ingredient_usage(ingredient_id uuid);create role anon;create role authenticated;`,
    );
    await db.query("update products set unit='kg' where id=$1", [id]);
    assert.equal(await stock(), 82.125);
    results.push(
      "Reproduced old defect: changing g to kg leaves the stock number unchanged",
    );
    await db.query("update products set unit='g' where id=$1", [id]);
    await db.exec(
      readFileSync(
        "supabase/migrations/012_preserve_inventory_units.sql",
        "utf8",
      ),
    );
    await assert.rejects(
      db.query("update products set unit='kg' where id=$1", [id]),
      /Inventory unit cannot change/,
    );
    assert.equal(
      (await db.query("select unit from products where id=$1", [id])).rows[0]
        .unit,
      "g",
    );
    results.push(
      "New trigger blocks relabelling existing stock without changing any balance",
    );
    const empty = "33333333-3333-4333-8333-333333333333";
    await db.query(
      "insert into products(id,product_type,current_stock,unit)values($1,'raw_material',0,'g')",
      [empty],
    );
    await db.query("update products set unit='kg' where id=$1", [empty]);
    results.push(
      "Unused materials can still select their initial inventory unit",
    );
    await db.query(
      "insert into product_recipes(ingredient_id,finished_product_id)values($1,$2)",
      [empty, id],
    );
    await assert.rejects(
      db.query("update products set unit='g' where id=$1", [empty]),
      /Inventory unit cannot change/,
    );
    results.push(
      "A zero-stock ingredient referenced by a recipe is also protected",
    );

    await db.exec(`alter table products add column name text default 'Test material',add column price_centavos bigint default 0,add column tracks_inventory boolean default true;
 alter table product_recipes add column quantity numeric(15,3) default 18;
 create table cash_shifts(id uuid primary key,opened_by uuid,status text,cashier_name text);
 create table sales(id uuid primary key,receipt text,business_date date,payment_method text,total_centavos bigint,created_by uuid,cash_shift_id uuid,cashier_name text,cash_received_centavos bigint,change_centavos bigint,client_reference uuid unique,status text default 'Completed',cancelled_by uuid,cancelled_at timestamptz);
 alter table sale_items add column sale_id uuid,add column product_name text,add column quantity integer,add column unit_price_centavos bigint,add column line_total_centavos bigint,add column tracks_inventory boolean;
 alter table sale_ingredient_usage add column sale_id uuid,add column ingredient_name text,add column quantity numeric(15,3),add column unit text;`);
    const saleSql = readFileSync(
      "supabase/migrations/007_fix_create_sale_ambiguous_id.sql",
      "utf8",
    );
    await db.exec(
      saleSql.match(
        /create or replace function public\.create_sale\([\s\S]*?\$\$;/i,
      )[0],
    );
    await db.exec(
      sql.match(
        /create or replace function public\.set_sale_status\([\s\S]*?\$\$;/i,
      )[0],
    );
    const drink = "44444444-4444-4444-8444-444444444444",
      reference = "55555555-5555-4555-8555-555555555555";
    await db.query(
      "insert into products(id,product_type,current_stock,unit,price_centavos)values($1,'finished_product',0,'serving',11000)",
      [drink],
    );
    await db.query(
      "insert into product_recipes(ingredient_id,finished_product_id,quantity)values($1,$2,18)",
      [id, drink],
    );
    await db.exec(
      "insert into cash_shifts values(gen_random_uuid(),auth.uid(),'Open','QA Staff')",
    );
    const saleBefore = await stock(),
      items = JSON.stringify([{ product_id: drink, quantity: 2 }]);
    const sold = (
      await db.query("select * from create_sale('GCash',$1::jsonb,null,$2)", [
        items,
        reference,
      ])
    ).rows[0];
    assert.equal(await stock(), saleBefore - 36);
    results.push("Completed sale deducts exact shared ingredient requirement");
    const retry = (
      await db.query("select * from create_sale('GCash',$1::jsonb,null,$2)", [
        items,
        reference,
      ])
    ).rows[0];
    assert.equal(retry.id, sold.id);
    assert.equal(await stock(), saleBefore - 36);
    results.push("Retrying the same payment does not deduct ingredients twice");
    await db.query("select set_sale_status($1,'Cancelled')", [sold.id]);
    assert.equal(await stock(), saleBefore);
    await db.query("select set_sale_status($1,'Cancelled')", [sold.id]);
    assert.equal(await stock(), saleBefore);
    results.push("Cancellation restores usage once and is safe to repeat");
    await db.query(
      "update product_recipes set quantity=30 where finished_product_id=$1",
      [drink],
    );
    await db.query("select set_sale_status($1,'Completed')", [sold.id]);
    assert.equal(await stock(), saleBefore - 36);
    results.push(
      "Restoring an order uses its saved ingredient snapshot even after recipe changes",
    );
    assert.equal(results.length, 14);
  } finally {
    await db.close();
  }
});
