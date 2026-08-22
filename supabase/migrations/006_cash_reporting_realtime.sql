-- Cash operations, inventory costing, receipt snapshots, and realtime support.

alter table public.products
  add column if not exists average_unit_cost_centavos numeric(18,6) not null default 0,
  add column if not exists cost_initialized boolean not null default false,
  add column if not exists cost_baseline_quantity numeric(15,3) not null default 0,
  add column if not exists cost_baseline_total_centavos bigint not null default 0;

alter table public.inventory_movements
  add column if not exists total_cost_centavos bigint,
  add column if not exists unit_cost_centavos numeric(18,6);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_total_cost_check;
alter table public.inventory_movements
  add constraint inventory_movements_total_cost_check
  check (total_cost_centavos is null or total_cost_centavos > 0);

create or replace function public.require_cost_on_authenticated_stock_entry()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and new.total_cost_centavos is null then
    raise exception 'New stock entries require a purchase cost';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_movements_require_cost on public.inventory_movements;
create trigger inventory_movements_require_cost
before insert or update of total_cost_centavos on public.inventory_movements
for each row execute function public.require_cost_on_authenticated_stock_entry();

revoke execute on function public.require_cost_on_authenticated_stock_entry() from public, anon, authenticated;

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles(id) on delete restrict,
  cashier_name text not null,
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  opening_balance_centavos bigint not null check (opening_balance_centavos >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  counted_cash_centavos bigint check (counted_cash_centavos >= 0),
  expected_cash_centavos bigint check (expected_cash_centavos >= 0),
  variance_centavos bigint,
  closing_note text not null default '' check (char_length(closing_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'Open' and closed_at is null and closed_by is null and counted_cash_centavos is null and expected_cash_centavos is null and variance_centavos is null)
    or
    (status = 'Closed' and closed_at is not null and closed_by is not null and counted_cash_centavos is not null and expected_cash_centavos is not null and variance_centavos is not null)
  )
);

create unique index if not exists idx_cash_shifts_one_open_per_cashier
  on public.cash_shifts(opened_by) where status = 'Open';
create index if not exists idx_cash_shifts_opened_at on public.cash_shifts(opened_at desc);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cash_shifts(id) on delete restrict,
  movement_type text not null check (movement_type in ('Cash In', 'Cash Out')),
  amount_centavos bigint not null check (amount_centavos > 0),
  reason text not null check (char_length(trim(reason)) between 1 and 160),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_movements_shift_created
  on public.cash_movements(shift_id, created_at desc);

alter table public.sales
  add column if not exists cash_shift_id uuid references public.cash_shifts(id) on delete restrict,
  add column if not exists cashier_name text,
  add column if not exists cash_received_centavos bigint,
  add column if not exists change_centavos bigint,
  add column if not exists client_reference uuid;

create unique index if not exists idx_sales_client_reference
  on public.sales(client_reference) where client_reference is not null;

update public.sales sale
set cashier_name = profile.display_name
from public.profiles profile
where sale.created_by = profile.id and sale.cashier_name is null;

update public.sales
set cash_received_centavos = total_centavos,
    change_centavos = 0
where payment_method = 'Cash' and cash_received_centavos is null;

alter table public.sales
  drop constraint if exists sales_cash_amounts_check;
alter table public.sales
  add constraint sales_cash_amounts_check check (
    (payment_method = 'Cash' and cash_received_centavos is not null and cash_received_centavos >= total_centavos and change_centavos = cash_received_centavos - total_centavos)
    or
    (payment_method <> 'Cash' and cash_received_centavos is null and change_centavos is null)
  );

create or replace function public.recalculate_material_cost(p_product_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_baseline_quantity numeric;
  v_baseline_total bigint;
  v_movement_quantity numeric;
  v_movement_total bigint;
begin
  select cost_baseline_quantity, cost_baseline_total_centavos
  into v_baseline_quantity, v_baseline_total
  from public.products
  where id = p_product_id and product_type = 'raw_material'
  for update;
  if not found then raise exception 'Raw material not found'; end if;

  select coalesce(sum(quantity), 0), coalesce(sum(total_cost_centavos), 0)
  into v_movement_quantity, v_movement_total
  from public.inventory_movements
  where product_id = p_product_id and total_cost_centavos is not null;

  update public.products
  set average_unit_cost_centavos = case
        when v_baseline_quantity + v_movement_quantity > 0
          then round((v_baseline_total + v_movement_total)::numeric / (v_baseline_quantity + v_movement_quantity), 6)
        else 0
      end,
      cost_initialized = v_baseline_quantity + v_movement_quantity > 0,
      updated_at = now()
  where id = p_product_id;
end;
$$;

create or replace function public.set_material_cost_baseline(p_product_id uuid, p_unit_cost_centavos numeric)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_product public.products%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_unit_cost_centavos is null or p_unit_cost_centavos <= 0 then raise exception 'Unit cost must be greater than zero'; end if;
  select * into v_product from public.products where id = p_product_id and product_type = 'raw_material' for update;
  if not found then raise exception 'Raw material not found'; end if;
  if v_product.current_stock <= 0 then raise exception 'Starting cost requires existing stock; add a costed stock entry instead'; end if;
  if v_product.cost_initialized or exists(select 1 from public.inventory_movements where product_id = p_product_id and total_cost_centavos is not null) then
    raise exception 'A cost basis is already configured for this material';
  end if;
  update public.products
  set cost_baseline_quantity = current_stock,
      cost_baseline_total_centavos = round(current_stock * p_unit_cost_centavos)::bigint,
      updated_at = now()
  where id = p_product_id;
  perform public.recalculate_material_cost(p_product_id);
end;
$$;

drop function if exists public.add_stock(uuid, numeric, date, text);
create function public.add_stock(p_product_id uuid, p_quantity numeric, p_date date, p_note text, p_total_cost_centavos bigint)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare v_id uuid := gen_random_uuid(); v_type text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_total_cost_centavos is null or p_total_cost_centavos <= 0 then raise exception 'Total purchase cost must be greater than zero'; end if;
  if p_date is null then raise exception 'Movement date is required'; end if;
  if char_length(coalesce(p_note, '')) > 160 then raise exception 'Note is too long'; end if;
  select product_type into v_type from public.products where id = p_product_id and active for update;
  if not found or v_type <> 'raw_material' then raise exception 'Raw material not found'; end if;
  insert into public.inventory_movements(id, product_id, quantity, note, movement_date, created_by, total_cost_centavos, unit_cost_centavos)
  values(v_id, p_product_id, round(p_quantity, 3), coalesce(p_note, ''), p_date, auth.uid(), p_total_cost_centavos, round(p_total_cost_centavos::numeric / p_quantity, 6));
  update public.products set current_stock = current_stock + round(p_quantity, 3), updated_at = now() where id = p_product_id;
  perform public.recalculate_material_cost(p_product_id);
  return v_id;
end;
$$;

drop function if exists public.update_stock_entry(uuid, numeric, date, text);
create function public.update_stock_entry(p_id uuid, p_quantity numeric, p_date date, p_note text, p_total_cost_centavos bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_movement public.inventory_movements%rowtype; v_product public.products%rowtype; v_next numeric; v_baseline_reduction numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_total_cost_centavos is null or p_total_cost_centavos <= 0 then raise exception 'Total purchase cost must be greater than zero'; end if;
  if p_date is null then raise exception 'Movement date is required'; end if;
  if char_length(coalesce(p_note, '')) > 160 then raise exception 'Note is too long'; end if;
  select * into v_movement from public.inventory_movements where id = p_id for update;
  if not found then raise exception 'Stock entry not found'; end if;
  select * into v_product from public.products where id = v_movement.product_id for update;
  v_next := v_product.current_stock - v_movement.quantity + round(p_quantity, 3);
  if v_next < 0 then raise exception 'This edit would make stock negative'; end if;
  if v_movement.total_cost_centavos is null and v_product.cost_baseline_quantity > 0 then
    v_baseline_reduction := least(v_movement.quantity, v_product.cost_baseline_quantity);
    update public.products
    set cost_baseline_total_centavos = round(cost_baseline_total_centavos::numeric * (cost_baseline_quantity - v_baseline_reduction) / cost_baseline_quantity)::bigint,
        cost_baseline_quantity = cost_baseline_quantity - v_baseline_reduction
    where id = v_movement.product_id;
  end if;
  update public.inventory_movements
  set quantity = round(p_quantity, 3), movement_date = p_date, note = coalesce(p_note, ''),
      total_cost_centavos = p_total_cost_centavos,
      unit_cost_centavos = round(p_total_cost_centavos::numeric / p_quantity, 6), updated_at = now()
  where id = p_id;
  update public.products set current_stock = v_next, updated_at = now() where id = v_movement.product_id;
  perform public.recalculate_material_cost(v_movement.product_id);
end;
$$;

create or replace function public.delete_stock_entry(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_movement public.inventory_movements%rowtype; v_product public.products%rowtype; v_baseline_reduction numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_movement from public.inventory_movements where id = p_id for update;
  if not found then raise exception 'Stock entry not found'; end if;
  select * into v_product from public.products where id = v_movement.product_id for update;
  if v_product.current_stock < v_movement.quantity then raise exception 'This stock has already been consumed and cannot be deleted'; end if;
  if v_movement.total_cost_centavos is null and v_product.cost_baseline_quantity > 0 then
    v_baseline_reduction := least(v_movement.quantity, v_product.cost_baseline_quantity);
    update public.products
    set cost_baseline_total_centavos = round(cost_baseline_total_centavos::numeric * (cost_baseline_quantity - v_baseline_reduction) / cost_baseline_quantity)::bigint,
        cost_baseline_quantity = cost_baseline_quantity - v_baseline_reduction
    where id = v_movement.product_id;
  end if;
  delete from public.inventory_movements where id = p_id;
  update public.products set current_stock = current_stock - v_movement.quantity, updated_at = now() where id = v_movement.product_id;
  perform public.recalculate_material_cost(v_movement.product_id);
end;
$$;

create or replace function public.cash_shift_expected(p_shift_id uuid)
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select shift.opening_balance_centavos
    + coalesce((select sum(sale.total_centavos) from public.sales sale where sale.cash_shift_id = shift.id and sale.payment_method = 'Cash' and sale.status = 'Completed'), 0)
    + coalesce((select sum(case when movement_type = 'Cash In' then amount_centavos else -amount_centavos end) from public.cash_movements movement where movement.shift_id = shift.id), 0)
  from public.cash_shifts shift where shift.id = p_shift_id
$$;

create or replace view public.cash_shift_summaries
with (security_invoker = true)
as
select
  shift.id,
  shift.opened_by,
  shift.cashier_name,
  shift.status,
  shift.opening_balance_centavos,
  shift.opened_at,
  shift.closed_at,
  shift.counted_cash_centavos,
  coalesce(shift.expected_cash_centavos, shift.opening_balance_centavos + sale.cash_sales_centavos + movement.cash_in_centavos - movement.cash_out_centavos) as expected_cash_centavos,
  shift.variance_centavos,
  shift.closing_note,
  sale.cash_sales_centavos,
  sale.digital_sales_centavos,
  movement.cash_in_centavos,
  movement.cash_out_centavos
from public.cash_shifts shift
cross join lateral (
  select
    coalesce(sum(total_centavos) filter (where payment_method = 'Cash' and status = 'Completed'), 0)::bigint as cash_sales_centavos,
    coalesce(sum(total_centavos) filter (where payment_method <> 'Cash' and status = 'Completed'), 0)::bigint as digital_sales_centavos
  from public.sales where cash_shift_id = shift.id
) sale
cross join lateral (
  select
    coalesce(sum(amount_centavos) filter (where movement_type = 'Cash In'), 0)::bigint as cash_in_centavos,
    coalesce(sum(amount_centavos) filter (where movement_type = 'Cash Out'), 0)::bigint as cash_out_centavos
  from public.cash_movements where shift_id = shift.id
) movement;

create or replace function public.open_cash_shift(p_opening_balance_centavos bigint)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare v_id uuid := gen_random_uuid(); v_name text; v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_opening_balance_centavos is null or p_opening_balance_centavos < 0 then raise exception 'Opening balance cannot be negative'; end if;
  select display_name, role into v_name, v_role from public.profiles where id = auth.uid();
  if v_name is null then raise exception 'Profile not found'; end if;
  if v_role <> 'staff' then raise exception 'Only staff accounts can open cashier shifts'; end if;
  insert into public.cash_shifts(id, opened_by, cashier_name, opening_balance_centavos)
  values(v_id, auth.uid(), v_name, p_opening_balance_centavos);
  return v_id;
exception when unique_violation then
  raise exception 'You already have an open cash shift';
end;
$$;

create or replace function public.record_cash_movement(p_shift_id uuid, p_type text, p_amount_centavos bigint, p_reason text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare v_id uuid := gen_random_uuid(); v_shift public.cash_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_type is null or p_type not in ('Cash In', 'Cash Out') then raise exception 'Invalid cash movement type'; end if;
  if p_amount_centavos is null or p_amount_centavos <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) > 160 then raise exception 'Reason must contain 1 to 160 characters'; end if;
  select * into v_shift from public.cash_shifts where id = p_shift_id for update;
  if not found or v_shift.status <> 'Open' then raise exception 'Open shift not found'; end if;
  if v_shift.opened_by <> auth.uid() then raise exception 'You can only manage your own shift'; end if;
  if p_type = 'Cash Out' and public.cash_shift_expected(p_shift_id) < p_amount_centavos then raise exception 'Cash out exceeds the expected drawer balance'; end if;
  insert into public.cash_movements(id, shift_id, movement_type, amount_centavos, reason, created_by)
  values(v_id, p_shift_id, p_type, p_amount_centavos, trim(p_reason), auth.uid());
  return v_id;
end;
$$;

create or replace function public.close_cash_shift(p_shift_id uuid, p_counted_cash_centavos bigint, p_note text default '')
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_shift public.cash_shifts%rowtype; v_expected bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_counted_cash_centavos is null or p_counted_cash_centavos < 0 then raise exception 'Counted cash cannot be negative'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'Closing note is too long'; end if;
  select * into v_shift from public.cash_shifts where id = p_shift_id for update;
  if not found or v_shift.status <> 'Open' then raise exception 'Open shift not found'; end if;
  if v_shift.opened_by <> auth.uid() then raise exception 'You can only close your own shift'; end if;
  v_expected := public.cash_shift_expected(p_shift_id);
  update public.cash_shifts set status = 'Closed', closed_at = now(), closed_by = auth.uid(),
    counted_cash_centavos = p_counted_cash_centavos, expected_cash_centavos = v_expected,
    variance_centavos = p_counted_cash_centavos - v_expected, closing_note = coalesce(trim(p_note), ''), updated_at = now()
  where id = p_shift_id;
end;
$$;

create or replace function public.force_close_cash_shift(p_shift_id uuid, p_counted_cash_centavos bigint, p_note text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_shift public.cash_shifts%rowtype; v_expected bigint;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_counted_cash_centavos is null or p_counted_cash_centavos < 0 then raise exception 'Counted cash cannot be negative'; end if;
  if nullif(trim(p_note), '') is null or char_length(trim(p_note)) > 300 then raise exception 'A force-close note is required'; end if;
  select * into v_shift from public.cash_shifts where id = p_shift_id for update;
  if not found or v_shift.status <> 'Open' then raise exception 'Open shift not found'; end if;
  v_expected := public.cash_shift_expected(p_shift_id);
  update public.cash_shifts set status = 'Closed', closed_at = now(), closed_by = auth.uid(),
    counted_cash_centavos = p_counted_cash_centavos, expected_cash_centavos = v_expected,
    variance_centavos = p_counted_cash_centavos - v_expected, closing_note = trim(p_note), updated_at = now()
  where id = p_shift_id;
end;
$$;

drop function if exists public.create_sale(text, jsonb);
create function public.create_sale(p_payment text, p_items jsonb, p_cash_received_centavos bigint, p_client_reference uuid)
returns table(id uuid, receipt text, total_centavos bigint, cash_received_centavos bigint, change_centavos bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_receipt text := 'RC-' || to_char(timezone('Asia/Manila', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_total bigint := 0; v_change bigint := null; v_item record; v_product public.products%rowtype; v_required numeric;
  v_shift public.cash_shifts%rowtype; v_cashier text; v_existing public.sales%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_client_reference is null then raise exception 'A payment submission reference is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_reference::text, 0));
  select sale.* into v_existing from public.sales sale where sale.client_reference = p_client_reference and sale.created_by = auth.uid();
  if found then
    return query select v_existing.id, v_existing.receipt, v_existing.total_centavos, v_existing.cash_received_centavos, v_existing.change_centavos;
    return;
  end if;
  if p_payment is null or p_payment not in ('Cash', 'GCash', 'Maya') then raise exception 'Invalid payment method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'An order needs at least one item'; end if;
  select * into v_shift from public.cash_shifts where opened_by = auth.uid() and status = 'Open' for update;
  if not found then raise exception 'Open a cashier shift before processing a sale'; end if;
  v_cashier := v_shift.cashier_name;

  for v_item in select x.product_id, sum(x.quantity)::integer quantity from jsonb_to_recordset(p_items) x(product_id uuid, quantity integer) group by x.product_id order by x.product_id loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Invalid item quantity'; end if;
    select * into v_product from public.products where products.id = v_item.product_id and active and product_type = 'finished_product' for update;
    if not found then raise exception 'Sales item is unavailable'; end if;
    if v_product.tracks_inventory and not exists(select 1 from public.product_recipes where finished_product_id = v_product.id) then raise exception '% does not have a recipe or unit-stock mapping', v_product.name; end if;
    v_total := v_total + v_product.price_centavos * v_item.quantity;
  end loop;

  if p_payment = 'Cash' then
    if p_cash_received_centavos is null or p_cash_received_centavos < v_total then raise exception 'Cash received must cover the order total'; end if;
    v_change := p_cash_received_centavos - v_total;
  elsif p_cash_received_centavos is not null then
    raise exception 'Cash received is only valid for cash payments';
  end if;

  for v_item in
    with order_items as (select x.product_id, sum(x.quantity)::numeric quantity from jsonb_to_recordset(p_items) x(product_id uuid, quantity integer) group by x.product_id)
    select recipe.ingredient_id, sum(recipe.quantity * order_items.quantity) required from order_items
    join public.products finished on finished.id = order_items.product_id and finished.tracks_inventory
    join public.product_recipes recipe on recipe.finished_product_id = order_items.product_id
    group by recipe.ingredient_id order by recipe.ingredient_id
  loop
    select * into v_product from public.products where id = v_item.ingredient_id and active and product_type = 'raw_material' for update;
    if not found then raise exception 'A recipe ingredient is unavailable'; end if;
    v_required := round(v_item.required, 3);
    if v_product.current_stock < v_required then raise exception '% only has % % remaining; % % is required', v_product.name, v_product.current_stock, v_product.unit, v_required, v_product.unit; end if;
  end loop;

  insert into public.sales(id, receipt, business_date, payment_method, total_centavos, created_by, cash_shift_id, cashier_name, cash_received_centavos, change_centavos, client_reference)
  values(v_id, v_receipt, timezone('Asia/Manila', now())::date, p_payment, v_total, auth.uid(), v_shift.id, v_cashier,
    case when p_payment = 'Cash' then p_cash_received_centavos else null end, v_change, p_client_reference);

  for v_item in select x.product_id, sum(x.quantity)::integer quantity from jsonb_to_recordset(p_items) x(product_id uuid, quantity integer) group by x.product_id loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.sale_items(sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos, tracks_inventory)
    values(v_id, v_product.id, v_product.name, v_item.quantity, v_product.price_centavos, v_product.price_centavos * v_item.quantity, v_product.tracks_inventory);
  end loop;

  insert into public.sale_ingredient_usage(sale_id, ingredient_id, ingredient_name, quantity, unit)
  with order_items as (select x.product_id, sum(x.quantity)::numeric quantity from jsonb_to_recordset(p_items) x(product_id uuid, quantity integer) group by x.product_id), usage as (
    select recipe.ingredient_id, round(sum(recipe.quantity * order_items.quantity), 3) quantity from order_items
    join public.products finished on finished.id = order_items.product_id and finished.tracks_inventory
    join public.product_recipes recipe on recipe.finished_product_id = order_items.product_id group by recipe.ingredient_id)
  select v_id, product.id, product.name, usage.quantity, product.unit from usage join public.products product on product.id = usage.ingredient_id;

  update public.products product set current_stock = product.current_stock - usage.quantity, updated_at = now()
  from public.sale_ingredient_usage usage where usage.sale_id = v_id and product.id = usage.ingredient_id;

  return query select v_id, v_receipt, v_total, case when p_payment = 'Cash' then p_cash_received_centavos else null end, v_change;
end;
$$;

create or replace function public.set_sale_status(p_sale_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_sale public.sales%rowtype; v_shift_status text; v_usage record; v_stock numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status is null or p_status not in ('Completed', 'Cancelled') then raise exception 'Invalid sale status'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.created_by <> auth.uid() and not public.is_admin() then raise exception 'You can only manage your own sales'; end if;
  if v_sale.status = p_status then return; end if;
  if v_sale.payment_method = 'Cash' and v_sale.cash_shift_id is not null then
    select status into v_shift_status from public.cash_shifts where id = v_sale.cash_shift_id;
    if v_shift_status = 'Closed' then raise exception 'Cash sales from a closed shift cannot be changed'; end if;
  end if;
  if not exists(select 1 from public.sale_ingredient_usage where sale_id = p_sale_id) and exists(select 1 from public.sale_items where sale_id = p_sale_id and tracks_inventory) then raise exception 'This legacy tracked sale has no ingredient-usage record and cannot safely change status'; end if;
  if p_status = 'Cancelled' then
    for v_usage in select * from public.sale_ingredient_usage where sale_id = p_sale_id order by ingredient_id loop
      update public.products set current_stock = current_stock + v_usage.quantity, updated_at = now() where id = v_usage.ingredient_id;
    end loop;
    update public.sales set status = 'Cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = p_sale_id;
  else
    for v_usage in select * from public.sale_ingredient_usage where sale_id = p_sale_id order by ingredient_id loop
      select current_stock into v_stock from public.products where id = v_usage.ingredient_id for update;
      if v_stock < v_usage.quantity then raise exception '% does not have enough stock to restore this order', v_usage.ingredient_name; end if;
      update public.products set current_stock = current_stock - v_usage.quantity, updated_at = now() where id = v_usage.ingredient_id;
    end loop;
    update public.sales set status = 'Completed', cancelled_by = null, cancelled_at = null where id = p_sale_id;
  end if;
end;
$$;

alter table public.cash_shifts enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists cash_shifts_read on public.cash_shifts;
create policy cash_shifts_read on public.cash_shifts for select to authenticated using (opened_by = auth.uid() or public.is_admin());
drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements for select to authenticated using (
  exists(select 1 from public.cash_shifts shift where shift.id = shift_id and (shift.opened_by = auth.uid() or public.is_admin()))
);

revoke all on public.cash_shifts, public.cash_movements from anon;
revoke insert, update, delete on public.cash_shifts, public.cash_movements from authenticated;
grant select on public.cash_shifts, public.cash_movements to authenticated;
revoke all on public.cash_shift_summaries from anon;
grant select on public.cash_shift_summaries to authenticated;

grant execute on function public.add_stock(uuid, numeric, date, text, bigint) to authenticated;
grant execute on function public.update_stock_entry(uuid, numeric, date, text, bigint) to authenticated;
grant execute on function public.delete_stock_entry(uuid) to authenticated;
grant execute on function public.set_material_cost_baseline(uuid, numeric) to authenticated;
grant execute on function public.open_cash_shift(bigint) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, bigint, text) to authenticated;
grant execute on function public.close_cash_shift(uuid, bigint, text) to authenticated;
grant execute on function public.force_close_cash_shift(uuid, bigint, text) to authenticated;
grant execute on function public.create_sale(text, jsonb, bigint, uuid) to authenticated;
grant execute on function public.set_sale_status(uuid, text) to authenticated;

revoke execute on function public.recalculate_material_cost(uuid) from public, anon, authenticated;
revoke execute on function public.cash_shift_expected(uuid) from public, anon, authenticated;
revoke execute on function public.add_stock(uuid, numeric, date, text, bigint) from public, anon;
revoke execute on function public.update_stock_entry(uuid, numeric, date, text, bigint) from public, anon;
revoke execute on function public.delete_stock_entry(uuid) from public, anon;
revoke execute on function public.set_material_cost_baseline(uuid, numeric) from public, anon;
revoke execute on function public.open_cash_shift(bigint) from public, anon;
revoke execute on function public.record_cash_movement(uuid, text, bigint, text) from public, anon;
revoke execute on function public.close_cash_shift(uuid, bigint, text) from public, anon;
revoke execute on function public.force_close_cash_shift(uuid, bigint, text) from public, anon;
revoke execute on function public.create_sale(text, jsonb, bigint, uuid) from public, anon;
revoke execute on function public.set_sale_status(uuid, text) from public, anon;

do $$
declare v_table text;
begin
  foreach v_table in array array['products','inventory_movements','sales','sale_items','sale_ingredient_usage','notifications','notification_reads','cash_shifts','cash_movements']
  loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
