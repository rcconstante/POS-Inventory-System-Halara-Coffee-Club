-- TEST / STAGING DATA ONLY.
-- Requires migrations 001 through 008 and the default menu from migration 003.
-- This seed is intentionally outside supabase/migrations so it is never applied
-- as production data. Re-running it resets only the named test materials and
-- the recipes for coffee and sandwiches below. Pastries and Pasta are not
-- inventory-tracked under the client's final scope clarification.

begin;

do $$
begin
  if not exists (select 1 from public.products where name = 'Halara Oat Latte') then
    raise exception 'Default menu is missing. Apply 003_default_menu.sql first.';
  end if;
end;
$$;

insert into public.categories(name)
values ('Raw Materials')
on conflict (name) do nothing;

with material(name, unit, opening_stock, low_stock_threshold) as (
  values
    ('Espresso Beans', 'g', 5000::numeric, 500::numeric),
    ('Oatside Milk', 'mL', 10000::numeric, 1000::numeric),
    ('Fresh Milk', 'mL', 10000::numeric, 1000::numeric),
    ('Condensed Milk', 'mL', 5000::numeric, 500::numeric),
    ('Chocolate Syrup', 'mL', 3000::numeric, 300::numeric),
    ('Vanilla Syrup', 'mL', 3000::numeric, 300::numeric),
    ('Yema Sauce', 'mL', 3000::numeric, 300::numeric),
    ('Sea Salt Cream', 'mL', 3000::numeric, 300::numeric),
    ('Chocnut Powder', 'g', 2000::numeric, 200::numeric),
    ('16 oz Cup', 'pcs', 500::numeric, 50::numeric),
    ('16 oz Lid', 'pcs', 500::numeric, 50::numeric),
    ('8 oz Cup', 'pcs', 100::numeric, 20::numeric),
    ('8 oz Lid', 'pcs', 100::numeric, 20::numeric),
    ('Sliced Bread', 'slice', 400::numeric, 40::numeric),
    ('Cheddar Cheese', 'slice', 200::numeric, 20::numeric),
    ('Ham', 'slice', 150::numeric, 15::numeric),
    ('Bacon', 'strip', 200::numeric, 20::numeric),
    ('Chicken Pastil Filling', 'g', 5000::numeric, 500::numeric),
    ('Butter', 'g', 2000::numeric, 200::numeric)
)
insert into public.products(
  name, category_id, product_type, tracks_inventory, unit, current_stock,
  low_stock_threshold, price_centavos, image_path, active
)
select
  material.name,
  category.id,
  'raw_material',
  true,
  material.unit,
  material.opening_stock,
  material.low_stock_threshold,
  0,
  null,
  true
from material
join public.categories category on category.name = 'Raw Materials'
on conflict (name) do update set
  category_id = excluded.category_id,
  product_type = 'raw_material',
  tracks_inventory = true,
  unit = excluded.unit,
  current_stock = excluded.current_stock,
  low_stock_threshold = excluded.low_stock_threshold,
  price_centavos = 0,
  image_path = null,
  active = true,
  updated_at = now();

delete from public.product_recipes recipe
using public.products finished
where recipe.finished_product_id = finished.id
  and finished.name in (
    'Halara Oat Latte', 'Mocha Oat', 'Yema''t Kape', 'Spanish Latte',
    'Seasalt Latte', 'Madagascar Vanilla Bean', 'Chocnut Latte', 'Fake Halara',
    'Blonde', 'Americano', 'Latte', 'Cappuccino', 'Cortado (8oz)',
    'Grilled Cheese', 'Ham & Cheese', 'Bacon & Cheese', 'Grilled Chicken Pastil',
    'Butter Croissant', 'Creamcheese Pimiento', 'Twice Baked Almond Croissant',
    'Twice Baked Pistachio Croissant', 'Uji Matcha Croissant', 'Golden Crunch',
    'Caradamia', 'Danish Roll - Cinnamon', 'Danish Roll - Ube Halaya',
    'New York Roll - Red Velvet', 'New York Roll - Cookies & Cream',
    'New York Roll - Belgian Almond', 'Cream-Filled Croissant - Lotus Biscoff',
    'Cream-Filled Croissant - Nutella', 'Croissant Tart - Classic',
    'Croissant Tart - Salted Caramel', 'Cromboloni - Pistachio Kataifi',
    'Cromboloni - Tiramisu'
  );

with recipe(finished_name, ingredient_name, quantity) as (
  values
    ('Halara Oat Latte', 'Espresso Beans', 18::numeric),
    ('Halara Oat Latte', 'Oatside Milk', 180::numeric),
    ('Halara Oat Latte', '16 oz Cup', 1::numeric),
    ('Halara Oat Latte', '16 oz Lid', 1::numeric),
    ('Mocha Oat', 'Espresso Beans', 18::numeric),
    ('Mocha Oat', 'Oatside Milk', 160::numeric),
    ('Mocha Oat', 'Chocolate Syrup', 20::numeric),
    ('Mocha Oat', '16 oz Cup', 1::numeric),
    ('Mocha Oat', '16 oz Lid', 1::numeric),
    ('Yema''t Kape', 'Espresso Beans', 18::numeric),
    ('Yema''t Kape', 'Fresh Milk', 150::numeric),
    ('Yema''t Kape', 'Yema Sauce', 30::numeric),
    ('Yema''t Kape', '16 oz Cup', 1::numeric),
    ('Yema''t Kape', '16 oz Lid', 1::numeric),
    ('Spanish Latte', 'Espresso Beans', 18::numeric),
    ('Spanish Latte', 'Fresh Milk', 140::numeric),
    ('Spanish Latte', 'Condensed Milk', 30::numeric),
    ('Spanish Latte', '16 oz Cup', 1::numeric),
    ('Spanish Latte', '16 oz Lid', 1::numeric),
    ('Seasalt Latte', 'Espresso Beans', 18::numeric),
    ('Seasalt Latte', 'Fresh Milk', 150::numeric),
    ('Seasalt Latte', 'Sea Salt Cream', 25::numeric),
    ('Seasalt Latte', '16 oz Cup', 1::numeric),
    ('Seasalt Latte', '16 oz Lid', 1::numeric),
    ('Madagascar Vanilla Bean', 'Espresso Beans', 18::numeric),
    ('Madagascar Vanilla Bean', 'Fresh Milk', 160::numeric),
    ('Madagascar Vanilla Bean', 'Vanilla Syrup', 20::numeric),
    ('Madagascar Vanilla Bean', '16 oz Cup', 1::numeric),
    ('Madagascar Vanilla Bean', '16 oz Lid', 1::numeric),
    ('Chocnut Latte', 'Espresso Beans', 18::numeric),
    ('Chocnut Latte', 'Fresh Milk', 160::numeric),
    ('Chocnut Latte', 'Chocnut Powder', 20::numeric),
    ('Chocnut Latte', '16 oz Cup', 1::numeric),
    ('Chocnut Latte', '16 oz Lid', 1::numeric),
    ('Fake Halara', 'Oatside Milk', 180::numeric),
    ('Fake Halara', 'Yema Sauce', 20::numeric),
    ('Fake Halara', '16 oz Cup', 1::numeric),
    ('Fake Halara', '16 oz Lid', 1::numeric),
    ('Blonde', 'Espresso Beans', 18::numeric),
    ('Blonde', 'Fresh Milk', 160::numeric),
    ('Blonde', '16 oz Cup', 1::numeric),
    ('Blonde', '16 oz Lid', 1::numeric),
    ('Americano', 'Espresso Beans', 18::numeric),
    ('Americano', '16 oz Cup', 1::numeric),
    ('Americano', '16 oz Lid', 1::numeric),
    ('Latte', 'Espresso Beans', 18::numeric),
    ('Latte', 'Fresh Milk', 180::numeric),
    ('Latte', '16 oz Cup', 1::numeric),
    ('Latte', '16 oz Lid', 1::numeric),
    ('Cappuccino', 'Espresso Beans', 18::numeric),
    ('Cappuccino', 'Fresh Milk', 150::numeric),
    ('Cappuccino', '16 oz Cup', 1::numeric),
    ('Cappuccino', '16 oz Lid', 1::numeric),
    ('Cortado (8oz)', 'Espresso Beans', 18::numeric),
    ('Cortado (8oz)', 'Fresh Milk', 90::numeric),
    ('Cortado (8oz)', '8 oz Cup', 1::numeric),
    ('Cortado (8oz)', '8 oz Lid', 1::numeric),
    ('Grilled Cheese', 'Sliced Bread', 2::numeric),
    ('Grilled Cheese', 'Cheddar Cheese', 2::numeric),
    ('Grilled Cheese', 'Butter', 10::numeric),
    ('Ham & Cheese', 'Sliced Bread', 2::numeric),
    ('Ham & Cheese', 'Ham', 2::numeric),
    ('Ham & Cheese', 'Cheddar Cheese', 1::numeric),
    ('Ham & Cheese', 'Butter', 10::numeric),
    ('Bacon & Cheese', 'Sliced Bread', 2::numeric),
    ('Bacon & Cheese', 'Bacon', 3::numeric),
    ('Bacon & Cheese', 'Cheddar Cheese', 1::numeric),
    ('Bacon & Cheese', 'Butter', 10::numeric),
    ('Grilled Chicken Pastil', 'Sliced Bread', 2::numeric),
    ('Grilled Chicken Pastil', 'Chicken Pastil Filling', 100::numeric),
    ('Grilled Chicken Pastil', 'Butter', 10::numeric)
)
insert into public.product_recipes(finished_product_id, ingredient_id, quantity)
select finished.id, ingredient.id, recipe.quantity
from recipe
join public.products finished
  on finished.name = recipe.finished_name
 and finished.product_type = 'finished_product'
 and finished.tracks_inventory
join public.products ingredient
  on ingredient.name = recipe.ingredient_name
 and ingredient.product_type = 'raw_material'
on conflict (finished_product_id, ingredient_id) do update set
  quantity = excluded.quantity,
  updated_at = now();

do $$
declare
  v_material_count integer;
  v_finished_count integer;
begin
  select count(*) into v_material_count
  from public.products
  where category_id = (select id from public.categories where name = 'Raw Materials')
    and product_type = 'raw_material'
    and active;

  select count(distinct finished_product_id) into v_finished_count
  from public.product_recipes recipe
  join public.products finished on finished.id = recipe.finished_product_id
  where finished.category_id in (
    select id from public.categories where name in ('Espresso Based', 'Sandwiches')
  );

  if v_material_count < 19 or v_finished_count <> 17 then
    raise exception 'Test seed validation failed: expected at least 19 materials and recipes for 17 sales items, got % and %',
      v_material_count, v_finished_count;
  end if;
end;
$$;

commit;
