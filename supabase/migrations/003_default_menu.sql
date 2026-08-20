-- Seed the client's default menu without stock photos or fabricated recipes.
-- Existing same-name categories and products are preserved.

insert into public.categories(name)
values
  ('Pastries'),
  ('Pasta'),
  ('Sandwiches'),
  ('Espresso Based'),
  ('Not Coffee'),
  ('Tea Refreshers and Soda'),
  ('Add-ons')
on conflict (name) do nothing;

with menu_item(name, category_name, price_centavos) as (
  values
    ('Butter Croissant', 'Pastries', 10000::bigint),
    ('Creamcheese Pimiento', 'Pastries', 19000::bigint),
    ('Twice Baked Almond Croissant', 'Pastries', 19000::bigint),
    ('Twice Baked Pistachio Croissant', 'Pastries', 19000::bigint),
    ('Uji Matcha Croissant', 'Pastries', 19000::bigint),
    ('Golden Crunch', 'Pastries', 19000::bigint),
    ('Caradamia', 'Pastries', 19000::bigint),
    ('Danish Roll - Cinnamon', 'Pastries', 15000::bigint),
    ('Danish Roll - Ube Halaya', 'Pastries', 15000::bigint),
    ('New York Roll - Red Velvet', 'Pastries', 15000::bigint),
    ('New York Roll - Cookies & Cream', 'Pastries', 15000::bigint),
    ('New York Roll - Belgian Almond', 'Pastries', 15000::bigint),
    ('Cream-Filled Croissant - Lotus Biscoff', 'Pastries', 19000::bigint),
    ('Cream-Filled Croissant - Nutella', 'Pastries', 19000::bigint),
    ('Croissant Tart - Classic', 'Pastries', 15000::bigint),
    ('Croissant Tart - Salted Caramel', 'Pastries', 15000::bigint),
    ('Cromboloni - Pistachio Kataifi', 'Pastries', 15000::bigint),
    ('Cromboloni - Tiramisu', 'Pastries', 15000::bigint),

    ('Pesto Basilico', 'Pasta', 19000::bigint),
    ('Calamansi Aligue', 'Pasta', 19000::bigint),
    ('Puttanesca Longga', 'Pasta', 22000::bigint),
    ('Toasted Bacon White Spaghetti', 'Pasta', 23000::bigint),

    ('Grilled Cheese', 'Sandwiches', 15000::bigint),
    ('Ham & Cheese', 'Sandwiches', 19000::bigint),
    ('Bacon & Cheese', 'Sandwiches', 20000::bigint),
    ('Grilled Chicken Pastil', 'Sandwiches', 21000::bigint),

    ('Halara Oat Latte', 'Espresso Based', 17000::bigint),
    ('Mocha Oat', 'Espresso Based', 17000::bigint),
    ('Yema''t Kape', 'Espresso Based', 16000::bigint),
    ('Spanish Latte', 'Espresso Based', 15000::bigint),
    ('Seasalt Latte', 'Espresso Based', 15000::bigint),
    ('Madagascar Vanilla Bean', 'Espresso Based', 15000::bigint),
    ('Chocnut Latte', 'Espresso Based', 17000::bigint),
    ('Fake Halara', 'Espresso Based', 14000::bigint),
    ('Blonde', 'Espresso Based', 15000::bigint),
    ('Americano', 'Espresso Based', 11000::bigint),
    ('Latte', 'Espresso Based', 13000::bigint),
    ('Cappuccino', 'Espresso Based', 13000::bigint),
    ('Cortado (8oz)', 'Espresso Based', 11000::bigint),

    ('Cocoa Artisan', 'Not Coffee', 14000::bigint),
    ('Champorado', 'Not Coffee', 15000::bigint),
    ('Uji Matcha Latte', 'Not Coffee', 16000::bigint),
    ('Blonde Uji', 'Not Coffee', 16000::bigint),
    ('Yema Oat', 'Not Coffee', 16000::bigint),
    ('Strawberry Milk', 'Not Coffee', 15000::bigint),
    ('Strawberry Kokomo Oat', 'Not Coffee', 17000::bigint),
    ('Oatxata', 'Not Coffee', 16000::bigint),

    ('Strawberry Hibiscus Brewed Tea', 'Tea Refreshers and Soda', 14000::bigint),
    ('Black Tea and Peach Brewed Tea', 'Tea Refreshers and Soda', 14000::bigint),
    ('Yuzu & Honey Passionfruit Tea', 'Tea Refreshers and Soda', 16000::bigint),
    ('Passionfruit & Yuzu Foam', 'Tea Refreshers and Soda', 16000::bigint),

    ('Add Espresso', 'Add-ons', 5000::bigint),
    ('Go Milk Oat', 'Add-ons', 4000::bigint),
    ('Go Chocolate Oat', 'Add-ons', 6000::bigint),
    ('Sauce Pump', 'Add-ons', 3000::bigint),
    ('Syrup Pump', 'Add-ons', 2500::bigint)
)
insert into public.products(
  name,
  category_id,
  product_type,
  unit,
  current_stock,
  low_stock_threshold,
  price_centavos,
  image_path,
  active
)
select
  menu_item.name,
  category.id,
  'finished_product',
  'serving',
  0,
  0,
  menu_item.price_centavos,
  null,
  true
from menu_item
join public.categories category on category.name = menu_item.category_name
on conflict (name) do nothing;
