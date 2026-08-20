-- Separate sellable finished products from stocked raw materials and make
-- ingredient consumption part of the same transaction as each sale.

alter table public.products
  add column if not exists product_type text;

update public.products
set product_type = case when price_centavos > 0 then 'finished_product' else 'raw_material' end
where product_type is null;

alter table public.products
  alter column product_type set default 'raw_material',
  alter column product_type set not null;

alter table public.products
  drop constraint if exists products_product_type_check;

alter table public.products
  add constraint products_product_type_check
  check (product_type in ('raw_material', 'finished_product'));

create table if not exists public.product_recipes (
  finished_product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(15,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (finished_product_id, ingredient_id),
  check (finished_product_id <> ingredient_id)
);

create table if not exists public.sale_ingredient_usage (
  sale_id uuid not null references public.sales(id) on delete cascade,
  ingredient_id uuid not null references public.products(id) on delete restrict,
  ingredient_name text not null,
  quantity numeric(15,3) not null check (quantity > 0),
  unit text not null,
  primary key (sale_id, ingredient_id)
);

create index if not exists idx_product_recipes_ingredient
  on public.product_recipes(ingredient_id);
create index if not exists idx_sale_ingredient_usage_ingredient
  on public.sale_ingredient_usage(ingredient_id);
create index if not exists idx_products_type_active
  on public.products(product_type, active);

create or replace function public.validate_product_recipe_row()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_finished_type text;
  v_ingredient_type text;
begin
  select product_type into v_finished_type
  from public.products
  where id = new.finished_product_id;

  select product_type into v_ingredient_type
  from public.products
  where id = new.ingredient_id;

  if v_finished_type is null or v_finished_type <> 'finished_product' then
    raise exception 'Recipes can only be assigned to finished products';
  end if;
  if v_ingredient_type is null or v_ingredient_type <> 'raw_material' then
    raise exception 'Recipe ingredients must be raw materials';
  end if;

  new.quantity := round(new.quantity, 3);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_product_recipe on public.product_recipes;
create trigger validate_product_recipe
before insert or update on public.product_recipes
for each row execute function public.validate_product_recipe_row();

create or replace function public.prevent_invalid_product_type_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.product_type = new.product_type then
    return new;
  end if;

  if exists (
    select 1 from public.sale_items where product_id = new.id
  ) or exists (
    select 1 from public.sale_ingredient_usage where ingredient_id = new.id
  ) then
    raise exception 'Product type cannot be changed after the product has transaction history';
  end if;

  if old.product_type = 'raw_material'
     and new.product_type = 'finished_product'
     and exists(select 1 from public.inventory_movements where product_id = new.id) then
    raise exception 'A stocked raw material cannot be converted into a finished product';
  end if;

  if new.product_type = 'raw_material' then
    delete from public.product_recipes where finished_product_id = new.id;
    new.price_centavos := 0;
  else
    if exists (
      select 1 from public.product_recipes where ingredient_id = new.id
    ) then
      raise exception 'This raw material is used by a product recipe';
    end if;
    new.current_stock := 0;
    new.low_stock_threshold := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_invalid_product_type_change on public.products;
create trigger prevent_invalid_product_type_change
before update of product_type on public.products
for each row execute function public.prevent_invalid_product_type_change();

create or replace function public.sync_inventory_alert(p_product_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_active_id uuid;
  v_type text;
  v_severity text;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return; end if;

  select id into v_active_id from public.notifications
  where dedupe_key = 'inventory:' || p_product_id::text and active limit 1;

  if v_product.product_type <> 'raw_material'
     or v_product.current_stock > v_product.low_stock_threshold then
    if v_active_id is not null then
      update public.notifications
      set active = false, resolved_at = now()
      where id = v_active_id;
    end if;
    return;
  end if;

  v_type := case when v_product.current_stock <= 0 then 'out_of_stock' else 'low_stock' end;
  v_severity := case when v_type = 'out_of_stock' then 'danger' else 'warning' end;

  if v_active_id is not null then
    update public.notifications set
      type = v_type,
      severity = v_severity,
      title = case when v_type = 'out_of_stock' then v_product.name || ' is out of stock' else v_product.name || ' is running low' end,
      message = v_product.current_stock || ' ' || v_product.unit || ' remaining; threshold is ' || v_product.low_stock_threshold || ' ' || v_product.unit || '.'
    where id = v_active_id;
  else
    insert into public.notifications(type, severity, title, message, product_id, dedupe_key)
    values (
      v_type,
      v_severity,
      case when v_type = 'out_of_stock' then v_product.name || ' is out of stock' else v_product.name || ' is running low' end,
      v_product.current_stock || ' ' || v_product.unit || ' remaining; threshold is ' || v_product.low_stock_threshold || ' ' || v_product.unit || '.',
      p_product_id,
      'inventory:' || p_product_id::text
    );
  end if;
end;
$$;

create or replace function public.save_catalog_product(
  p_id uuid,
  p_name text,
  p_category_id uuid,
  p_product_type text,
  p_unit text,
  p_low_stock_threshold numeric,
  p_price_centavos bigint,
  p_image_path text,
  p_recipe jsonb default '[]'::jsonb,
  p_initial_stock numeric default 0
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_is_new boolean;
  v_recipe_count integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 80 then
    raise exception 'Product name must contain 1 to 80 characters';
  end if;
  if nullif(trim(p_unit), '') is null or char_length(trim(p_unit)) > 12 then
    raise exception 'Unit must contain 1 to 12 characters';
  end if;
  if p_product_type is null or p_product_type not in ('raw_material', 'finished_product') then
    raise exception 'Invalid product type';
  end if;
  if p_low_stock_threshold is null or p_low_stock_threshold < 0 then
    raise exception 'Low-stock threshold cannot be negative';
  end if;
  if p_price_centavos is null or p_price_centavos < 0 then
    raise exception 'Price cannot be negative';
  end if;
  if p_image_path is not null and char_length(p_image_path) > 500 then
    raise exception 'Image path is too long';
  end if;
  if jsonb_typeof(coalesce(p_recipe, '[]'::jsonb)) <> 'array' then
    raise exception 'Recipe must be an array';
  end if;

  select not exists(select 1 from public.products where id = v_id)
  into v_is_new;

  if v_is_new then
    if p_initial_stock is null or p_initial_stock < 0 then
      raise exception 'Opening stock cannot be negative';
    end if;
    insert into public.products(
      id, name, category_id, product_type, unit, current_stock,
      low_stock_threshold, price_centavos, image_path
    ) values (
      v_id, trim(p_name), p_category_id, p_product_type, trim(p_unit),
      case when p_product_type = 'raw_material' then round(p_initial_stock, 3) else 0 end,
      case when p_product_type = 'raw_material' then round(p_low_stock_threshold, 3) else 0 end,
      case when p_product_type = 'finished_product' then p_price_centavos else 0 end,
      p_image_path
    );

    if p_product_type = 'raw_material' and p_initial_stock > 0 then
      insert into public.inventory_movements(product_id, quantity, note, movement_date, created_by)
      values(v_id, round(p_initial_stock, 3), 'Opening stock', (timezone('Asia/Manila', now()))::date, auth.uid());
    end if;
  else
    update public.products set
      name = trim(p_name),
      category_id = p_category_id,
      product_type = p_product_type,
      unit = trim(p_unit),
      low_stock_threshold = case when p_product_type = 'raw_material' then round(p_low_stock_threshold, 3) else 0 end,
      price_centavos = case when p_product_type = 'finished_product' then p_price_centavos else 0 end,
      image_path = p_image_path,
      updated_at = now()
    where id = v_id;
  end if;

  delete from public.product_recipes where finished_product_id = v_id;

  if p_product_type = 'finished_product' then
    select count(*) into v_recipe_count
    from jsonb_to_recordset(p_recipe) as x(ingredient_id uuid, quantity numeric);

    if v_recipe_count = 0 then
      raise exception 'A finished product needs at least one recipe ingredient';
    end if;

    if v_recipe_count <> (
      select count(distinct x.ingredient_id)
      from jsonb_to_recordset(p_recipe) as x(ingredient_id uuid, quantity numeric)
    ) then
      raise exception 'Each ingredient can appear only once in a recipe';
    end if;

    insert into public.product_recipes(finished_product_id, ingredient_id, quantity)
    select v_id, x.ingredient_id, round(x.quantity, 3)
    from jsonb_to_recordset(p_recipe) as x(ingredient_id uuid, quantity numeric)
    where x.ingredient_id is not null and x.quantity > 0;

    if (select count(*) from public.product_recipes where finished_product_id = v_id) <> v_recipe_count then
      raise exception 'Every recipe quantity must be greater than zero';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.add_stock(p_product_id uuid, p_quantity numeric, p_date date, p_note text default '')
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_date is null then raise exception 'Movement date is required'; end if;
  if char_length(coalesce(p_note, '')) > 160 then raise exception 'Note cannot exceed 160 characters'; end if;

  perform 1 from public.products
  where id = p_product_id and active and product_type = 'raw_material'
  for update;
  if not found then raise exception 'Raw material not found'; end if;

  insert into public.inventory_movements(id, product_id, quantity, note, movement_date, created_by)
  values(v_id, p_product_id, round(p_quantity, 3), coalesce(p_note, ''), p_date, auth.uid());
  update public.products
  set current_stock = current_stock + round(p_quantity, 3), updated_at = now()
  where id = p_product_id;
  return v_id;
end;
$$;

create or replace function public.update_stock_entry(p_id uuid, p_quantity numeric, p_date date, p_note text default '')
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_next numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 or p_date is null then raise exception 'Invalid stock adjustment'; end if;
  if char_length(coalesce(p_note, '')) > 160 then raise exception 'Note cannot exceed 160 characters'; end if;

  select movement.* into v_movement
  from public.inventory_movements movement
  join public.products product on product.id = movement.product_id
  where movement.id = p_id and product.product_type = 'raw_material'
  for update of movement;
  if not found then raise exception 'Raw material stock entry not found'; end if;

  select current_stock - v_movement.quantity + round(p_quantity, 3) into v_next
  from public.products where id = v_movement.product_id for update;
  if v_next < 0 then raise exception 'Some of this stock has already been used'; end if;

  update public.inventory_movements
  set quantity = round(p_quantity, 3), movement_date = p_date,
      note = coalesce(p_note, ''), updated_at = now()
  where id = p_id;
  update public.products set current_stock = v_next, updated_at = now()
  where id = v_movement.product_id;
  return p_id;
end;
$$;

create or replace function public.delete_stock_entry(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_stock numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;

  select movement.* into v_movement
  from public.inventory_movements movement
  join public.products product on product.id = movement.product_id
  where movement.id = p_id and product.product_type = 'raw_material'
  for update of movement;
  if not found then raise exception 'Raw material stock entry not found'; end if;

  select current_stock into v_stock from public.products
  where id = v_movement.product_id for update;
  if v_stock - v_movement.quantity < 0 then raise exception 'Some of this stock has already been used'; end if;

  delete from public.inventory_movements where id = p_id;
  update public.products
  set current_stock = current_stock - v_movement.quantity, updated_at = now()
  where id = v_movement.product_id;
end;
$$;

create or replace function public.create_sale(p_payment text, p_items jsonb)
returns table(id uuid, receipt text, total_centavos bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_receipt text := 'RC-' || to_char(timezone('Asia/Manila', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_total bigint := 0;
  v_item record;
  v_product public.products%rowtype;
  v_required numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_payment is null or p_payment not in ('Cash', 'GCash', 'Maya') then raise exception 'Invalid payment method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item';
  end if;

  -- Lock sellable products deterministically and calculate the server-owned total.
  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
    order by x.product_id
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Invalid item quantity';
    end if;
    select * into v_product
    from public.products
    where products.id = v_item.product_id
      and active
      and product_type = 'finished_product'
    for update;
    if not found then raise exception 'Sales item is unavailable'; end if;
    if not exists(select 1 from public.product_recipes where finished_product_id = v_product.id) then
      raise exception '% does not have a recipe', v_product.name;
    end if;
    v_total := v_total + (v_product.price_centavos * v_item.quantity);
  end loop;

  -- Aggregate shared ingredients across the complete order, then lock and check
  -- every raw material before writing any sale data.
  for v_item in
    with order_items as (
      select x.product_id, sum(x.quantity)::numeric as quantity
      from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
      group by x.product_id
    )
    select recipe.ingredient_id, sum(recipe.quantity * order_items.quantity) as required
    from order_items
    join public.product_recipes recipe on recipe.finished_product_id = order_items.product_id
    group by recipe.ingredient_id
    order by recipe.ingredient_id
  loop
    select * into v_product
    from public.products
    where id = v_item.ingredient_id and active and product_type = 'raw_material'
    for update;
    if not found then raise exception 'A recipe ingredient is unavailable'; end if;
    v_required := round(v_item.required, 3);
    if v_product.current_stock < v_required then
      raise exception '% only has % % remaining; % % is required',
        v_product.name, v_product.current_stock, v_product.unit, v_required, v_product.unit;
    end if;
  end loop;

  insert into public.sales(id, receipt, business_date, payment_method, total_centavos, created_by)
  values(v_id, v_receipt, (timezone('Asia/Manila', now()))::date, p_payment, v_total, auth.uid());

  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.sale_items(sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos)
    values(v_id, v_product.id, v_product.name, v_item.quantity, v_product.price_centavos, v_product.price_centavos * v_item.quantity);
  end loop;

  insert into public.sale_ingredient_usage(sale_id, ingredient_id, ingredient_name, quantity, unit)
  with order_items as (
    select x.product_id, sum(x.quantity)::numeric as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  ), usage as (
    select recipe.ingredient_id, round(sum(recipe.quantity * order_items.quantity), 3) as quantity
    from order_items
    join public.product_recipes recipe on recipe.finished_product_id = order_items.product_id
    group by recipe.ingredient_id
  )
  select v_id, product.id, product.name, usage.quantity, product.unit
  from usage
  join public.products product on product.id = usage.ingredient_id;

  update public.products product
  set current_stock = product.current_stock - usage.quantity,
      updated_at = now()
  from public.sale_ingredient_usage usage
  where usage.sale_id = v_id and product.id = usage.ingredient_id;

  return query select v_id, v_receipt, v_total;
end;
$$;

create or replace function public.set_sale_status(p_sale_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_usage record;
  v_stock numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status is null or p_status not in ('Completed', 'Cancelled') then raise exception 'Invalid sale status'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = p_status then return; end if;
  if not exists(select 1 from public.sale_ingredient_usage where sale_id = p_sale_id) then
    raise exception 'This legacy sale has no ingredient-usage record and cannot safely change status';
  end if;

  if p_status = 'Cancelled' then
    for v_usage in
      select * from public.sale_ingredient_usage where sale_id = p_sale_id order by ingredient_id
    loop
      update public.products
      set current_stock = current_stock + v_usage.quantity, updated_at = now()
      where id = v_usage.ingredient_id;
    end loop;
    update public.sales
    set status = 'Cancelled', cancelled_by = auth.uid(), cancelled_at = now()
    where id = p_sale_id;
  else
    for v_usage in
      select * from public.sale_ingredient_usage where sale_id = p_sale_id order by ingredient_id
    loop
      select current_stock into v_stock
      from public.products
      where id = v_usage.ingredient_id
      for update;
      if v_stock < v_usage.quantity then
        raise exception '% does not have enough stock to restore this order', v_usage.ingredient_name;
      end if;
      update public.products
      set current_stock = current_stock - v_usage.quantity, updated_at = now()
      where id = v_usage.ingredient_id;
    end loop;
    update public.sales
    set status = 'Completed', cancelled_by = null, cancelled_at = null
    where id = p_sale_id;
  end if;
end;
$$;

alter table public.product_recipes enable row level security;
alter table public.sale_ingredient_usage enable row level security;

drop policy if exists product_recipes_read on public.product_recipes;
create policy product_recipes_read on public.product_recipes
for select to authenticated using (true);
drop policy if exists product_recipes_admin_write on public.product_recipes;
create policy product_recipes_admin_write on public.product_recipes
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sale_ingredient_usage_read on public.sale_ingredient_usage;
create policy sale_ingredient_usage_read on public.sale_ingredient_usage
for select to authenticated using (true);

grant execute on function public.save_catalog_product(uuid, text, uuid, text, text, numeric, bigint, text, jsonb, numeric) to authenticated;
revoke execute on function public.save_catalog_product(uuid, text, uuid, text, text, numeric, bigint, text, jsonb, numeric) from public, anon;
revoke execute on function public.validate_product_recipe_row() from public, anon, authenticated;
revoke execute on function public.prevent_invalid_product_type_change() from public, anon, authenticated;

update public.notifications notification
set active = false, resolved_at = coalesce(resolved_at, now())
from public.products product
where notification.product_id = product.id
  and notification.active
  and product.product_type = 'finished_product';
