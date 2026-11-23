import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";

const fn = (sql, name) =>
  sql.match(new RegExp("create (?:or replace )?function public\\." + name + "\\([\\s\\S]*?\\$\\$;", "i"))[0];

test("stock ledger records every in/out change with the running balance", async () => {
  const db = new PGlite();
  const m006 = readFileSync("supabase/migrations/006_cash_reporting_realtime.sql", "utf8");
  const m007 = readFileSync("supabase/migrations/007_fix_create_sale_ambiguous_id.sql", "utf8");
  try {
    await db.exec(`create role anon; create role authenticated;
 create schema auth; create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function public.is_admin() returns boolean language sql as $$select true$$;
 create table profiles(id uuid primary key, display_name text);
 insert into profiles values('11111111-1111-4111-8111-111111111111','QA Admin');
 create table products(id uuid primary key, name text default 'Beans', unit text default 'g', product_type text not null, active boolean default true, tracks_inventory boolean default true, price_centavos bigint default 0,
   current_stock numeric(15,3) not null check(current_stock>=0), cost_baseline_quantity numeric(15,3) default 0, cost_baseline_total_centavos bigint default 0,
   average_unit_cost_centavos numeric(18,6) default 0, cost_initialized boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
 create table inventory_movements(id uuid primary key, product_id uuid references products, quantity numeric(15,3) not null check(quantity>0), note text, movement_date date, created_by uuid,
   total_cost_centavos bigint, unit_cost_centavos numeric(18,6), created_at timestamptz default now(), updated_at timestamptz default now());
 create table product_recipes(finished_product_id uuid, ingredient_id uuid, quantity numeric(15,3));
 create table cash_shifts(id uuid primary key, opened_by uuid, status text, cashier_name text);
 create table sales(id uuid primary key, receipt text, business_date date, payment_method text, total_centavos bigint, created_by uuid, cash_shift_id uuid, cashier_name text,
   cash_received_centavos bigint, change_centavos bigint, client_reference uuid unique, status text default 'Completed', cancelled_by uuid, cancelled_at timestamptz, created_at timestamptz default now());
 create table sale_items(sale_id uuid, product_id uuid, product_name text, quantity integer, unit_price_centavos bigint, line_total_centavos bigint, tracks_inventory boolean);
 create table sale_ingredient_usage(sale_id uuid, ingredient_id uuid, ingredient_name text, quantity numeric(15,3), unit text);`);
    for (const name of ["recalculate_material_cost", "add_stock", "update_stock_entry", "delete_stock_entry"]) await db.exec(fn(m006, name));
    await db.exec(fn(m007, "create_sale"));

    // Pre-migration state: seeded 5,000 g with no delivery row, plus one delivery.
    const beans = "22222222-2222-4222-8222-222222222222";
    const drink = "44444444-4444-4444-8444-444444444444";
    await db.query("insert into products(id,product_type,current_stock,created_at) values($1,'raw_material',5000,now()-interval '2 days')", [beans]);
    await db.query("select add_stock($1,1000,'2026-11-20','Old delivery',10000)", [beans]);

    await db.exec(readFileSync("supabase/migrations/013_stock_ledger.sql", "utf8"));
    const ledger = async () => (await db.query("select change::float8, balance_after::float8, kind, reference, actor_name, reconstructed from stock_ledger where product_id=$1 order by id", [beans])).rows;
    const stock = async () => Number((await db.query("select current_stock from products where id=$1", [beans])).rows[0].current_stock);

    let rows = await ledger();
    assert.deepEqual(rows.map((r) => [r.kind, r.change, r.balance_after, r.reconstructed]), [
      ["Opening balance", 5000, 5000, true],
      ["Delivery", 1000, 6000, true],
    ]);

    const added = (await db.query("select add_stock($1,5000,'2026-11-23','Supplier A',50000) as id", [beans])).rows[0].id;
    await db.query("select update_stock_entry($1,4000,'2026-11-23','Supplier A',40000)", [added]);
    await db.query("insert into products(id,product_type,current_stock,price_centavos) values($1,'finished_product',0,11000)", [drink]);
    await db.query("insert into product_recipes values($1,$2,18)", [drink, beans]);
    await db.exec("insert into cash_shifts values(gen_random_uuid(),auth.uid(),'Open','QA')");
    const sale = (await db.query("select * from create_sale('GCash',$1::jsonb,null,gen_random_uuid())", [JSON.stringify([{ product_id: drink, quantity: 100 }])])).rows[0];
    await db.query("select set_sale_status($1,'Cancelled')", [sale.id]);
    await db.query("select set_sale_status($1,'Completed')", [sale.id]);
    await db.query("select delete_stock_entry($1)", [added]);
    await db.query("update products set current_stock=current_stock-1 where id=$1", [beans]);

    rows = (await ledger()).slice(2);
    assert.deepEqual(rows.map((r) => [r.kind, r.change, r.balance_after]), [
      ["Delivery", 5000, 11000],
      ["Delivery edit", -1000, 10000],
      ["Sale", -1800, 8200],
      ["Order cancelled", 1800, 10000],
      ["Order restored", -1800, 8200],
      ["Delivery deleted", -4000, 4200],
      ["Adjustment", -1, 4199],
    ]);
    assert.equal(rows[0].reference, "Supplier A");
    assert.match(rows[1].reference, /changed from 5000\.000 to 4000\.000/);
    assert.equal(rows[2].reference, sale.receipt);
    assert.equal(rows[0].actor_name, "QA Admin");
    assert.equal((await ledger()).at(-1).balance_after, await stock());
    const net = (await db.query("select sum(change)::float8 as s from stock_ledger where product_id=$1", [beans])).rows[0].s;
    assert.equal(net, await stock());
    // Finished products never get ledger rows.
    assert.equal((await db.query("select count(*)::int as n from stock_ledger where product_id=$1", [drink])).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
