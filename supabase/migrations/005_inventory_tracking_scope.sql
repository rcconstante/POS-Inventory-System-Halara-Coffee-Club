-- Support menu items that are intentionally excluded from inventory tracking.
-- Coffee, sandwiches, and per-unit pastries remain tracked. Pasta and the
-- remaining menu sections can be sold without fabricated ingredient usage.

alter table public.products
  add column if not exists tracks_inventory boolean;

update public.products product
set tracks_inventory = case
  when product.product_type = 'raw_material' then true
  when category.name in ('Pasta', 'Not Coffee', 'Tea Refreshers and Soda', 'Add-ons') then false
  else true
end
from public.categories category
where category.id = product.category_id;

update public.products
set tracks_inventory = true
where tracks_inventory is null;

alter table public.products
  alter column tracks_inventory set default true,
  alter column tracks_inventory set not null;

alter table public.sale_items
  add column if not exists tracks_inventory boolean not null default true;

-- Best-effort backfill for pre-migration sales. New sales always snapshot the
-- flag at checkout and do not depend on later catalog changes.
update public.sale_items item
set tracks_inventory = product.tracks_inventory
from public.products product
where product.id = item.product_id;

-- Keep the client-approved scope consistent for newly-created products and
-- products moved between categories. Raw materials are always stock tracked.
create or replace function public.apply_product_inventory_scope()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_category_name text;
begin
  if new.product_type = 'raw_material' then
    new.tracks_inventory := true;
    return new;
  end if;

  select name into v_category_name
  from public.categories
  where id = new.category_id;

  if not found then
    raise exception 'Category not found';
  end if;

  new.tracks_inventory := v_category_name not in (
    'Pasta',
    'Not Coffee',
    'Tea Refreshers and Soda',
    'Add-ons'
  );

  if tg_op = 'UPDATE' and old.tracks_inventory and not new.tracks_inventory then
    delete from public.product_recipes where finished_product_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_product_inventory_scope on public.products;
create trigger apply_product_inventory_scope
before insert or update of category_id, product_type on public.products
for each row execute function public.apply_product_inventory_scope();

revoke execute on function public.apply_product_inventory_scope() from public, anon, authenticated;

create or replace function public.validate_product_recipe_row()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_finished_type text;
  v_tracks_inventory boolean;
  v_ingredient_type text;
begin
  select product_type, tracks_inventory into v_finished_type, v_tracks_inventory
  from public.products
  where id = new.finished_product_id;

  select product_type into v_ingredient_type
  from public.products
  where id = new.ingredient_id;

  if v_finished_type is null or v_finished_type <> 'finished_product' then
    raise exception 'Recipes can only be assigned to finished products';
  end if;
  if not v_tracks_inventory then
    raise exception 'This sales category does not use inventory recipes';
  end if;
  if v_ingredient_type is null or v_ingredient_type <> 'raw_material' then
    raise exception 'Recipe ingredients must be raw materials';
  end if;

  new.quantity := round(new.quantity, 3);
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.validate_product_recipe_row() from public, anon, authenticated;

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
    if v_product.tracks_inventory
       and not exists(select 1 from public.product_recipes where finished_product_id = v_product.id) then
      raise exception '% does not have a recipe or unit-stock mapping', v_product.name;
    end if;
    v_total := v_total + (v_product.price_centavos * v_item.quantity);
  end loop;

  for v_item in
    with order_items as (
      select x.product_id, sum(x.quantity)::numeric as quantity
      from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
      group by x.product_id
    )
    select recipe.ingredient_id, sum(recipe.quantity * order_items.quantity) as required
    from order_items
    join public.products finished on finished.id = order_items.product_id and finished.tracks_inventory
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
    insert into public.sale_items(
      sale_id, product_id, product_name, quantity, unit_price_centavos,
      line_total_centavos, tracks_inventory
    ) values (
      v_id, v_product.id, v_product.name, v_item.quantity,
      v_product.price_centavos, v_product.price_centavos * v_item.quantity,
      v_product.tracks_inventory
    );
  end loop;

  insert into public.sale_ingredient_usage(sale_id, ingredient_id, ingredient_name, quantity, unit)
  with order_items as (
    select x.product_id, sum(x.quantity)::numeric as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  ), usage as (
    select recipe.ingredient_id, round(sum(recipe.quantity * order_items.quantity), 3) as quantity
    from order_items
    join public.products finished on finished.id = order_items.product_id and finished.tracks_inventory
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
  if not exists(select 1 from public.sale_ingredient_usage where sale_id = p_sale_id)
     and exists(select 1 from public.sale_items where sale_id = p_sale_id and tracks_inventory) then
    raise exception 'This legacy tracked sale has no ingredient-usage record and cannot safely change status';
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
