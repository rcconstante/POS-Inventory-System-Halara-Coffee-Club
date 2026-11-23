-- Append-only In/Out history for every raw-material stock change.
-- Each change to products.current_stock writes one ledger row with the change,
-- the balance afterwards, what caused it and who did it. Delivery edits and
-- deletions are recorded instead of silently overwriting history.

begin;

create table if not exists public.stock_ledger (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  change numeric(15,3) not null,
  balance_after numeric(15,3) not null,
  kind text not null check (kind in (
    'Opening balance', 'Delivery', 'Delivery edit', 'Delivery deleted',
    'Sale', 'Order cancelled', 'Order restored', 'Adjustment'
  )),
  reference text not null default '',
  actor_name text not null default '',
  reconstructed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_ledger_product_created
  on public.stock_ledger(product_id, created_at desc, id desc);
create index if not exists idx_stock_ledger_created
  on public.stock_ledger(created_at desc, id desc);

-- Source-table triggers and RPCs label the next stock change in this transaction.
create or replace function public.set_stock_reason(p_kind text, p_reference text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('halara.stock_kind', coalesce(p_kind, ''), true);
  perform set_config('halara.stock_ref', left(coalesce(p_reference, ''), 200), true);
end;
$$;

create or replace function public.label_inventory_movement_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.set_stock_reason('Delivery', coalesce(nullif(trim(new.note), ''), 'Supplier delivery'));
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.set_stock_reason('Delivery edit',
      'Delivery of ' || old.movement_date || ' changed from ' || old.quantity || ' to ' || new.quantity);
    return new;
  end if;
  perform public.set_stock_reason('Delivery deleted',
    'Deleted delivery of ' || old.movement_date || ' (' || old.quantity || ')');
  return old;
end;
$$;

drop trigger if exists label_inventory_movement_change on public.inventory_movements;
create trigger label_inventory_movement_change
before insert or update of quantity or delete on public.inventory_movements
for each row execute function public.label_inventory_movement_change();

create or replace function public.label_sale_usage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_receipt text;
begin
  select sale.receipt into v_receipt from public.sales sale where sale.id = new.sale_id;
  perform public.set_stock_reason('Sale', coalesce(v_receipt, 'Sale'));
  return new;
end;
$$;

drop trigger if exists label_sale_usage on public.sale_ingredient_usage;
create trigger label_sale_usage
before insert on public.sale_ingredient_usage
for each row execute function public.label_sale_usage();

create or replace function public.record_stock_ledger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_change numeric := new.current_stock - case when tg_op = 'INSERT' then 0 else old.current_stock end;
  v_kind text := nullif(current_setting('halara.stock_kind', true), '');
  v_actor text := '';
begin
  if new.product_type <> 'raw_material' or v_change = 0 then return new; end if;
  if auth.uid() is not null then
    select profile.display_name into v_actor from public.profiles profile where profile.id = auth.uid();
  end if;
  insert into public.stock_ledger(product_id, change, balance_after, kind, reference, actor_name)
  values (
    new.id, v_change, new.current_stock,
    coalesce(v_kind, case when tg_op = 'INSERT' then 'Opening balance' else 'Adjustment' end),
    case when v_kind is null then '' else coalesce(current_setting('halara.stock_ref', true), '') end,
    coalesce(v_actor, '')
  );
  return new;
end;
$$;

drop trigger if exists record_stock_ledger on public.products;
create trigger record_stock_ledger
after insert or update of current_stock on public.products
for each row execute function public.record_stock_ledger();

-- Same behaviour as 006, plus a ledger label before stock is restored or re-deducted.
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
  perform public.set_stock_reason(case when p_status = 'Cancelled' then 'Order cancelled' else 'Order restored' end, v_sale.receipt);
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

-- One-time reconstruction of history that existed before this migration.
-- Delivery quantities are their current (possibly edited) values; earlier edits
-- were not stored. Any balance not explained by deliveries and sales becomes an
-- "Opening balance" row so every material's running balance ends at current_stock.
insert into public.stock_ledger(product_id, change, balance_after, kind, reference, reconstructed, created_at)
with events as (
  select movement.product_id, movement.quantity as change, 'Delivery'::text as kind,
         coalesce(nullif(trim(movement.note), ''), 'Supplier delivery') as reference, movement.created_at
  from public.inventory_movements movement
  union all
  select usage.ingredient_id, -usage.quantity, 'Sale', sale.receipt, sale.created_at
  from public.sale_ingredient_usage usage join public.sales sale on sale.id = usage.sale_id
  union all
  select usage.ingredient_id, usage.quantity, 'Order cancelled', sale.receipt, sale.cancelled_at
  from public.sale_ingredient_usage usage join public.sales sale on sale.id = usage.sale_id
  where sale.status = 'Cancelled' and sale.cancelled_at is not null
), opening as (
  select product.id as product_id,
         product.current_stock - coalesce(sum(events.change), 0) as change,
         'Opening balance'::text as kind,
         'Balance before history was recorded' as reference,
         least(product.created_at, coalesce(min(events.created_at), product.created_at)) - interval '1 second' as created_at
  from public.products product
  left join events on events.product_id = product.id
  where product.product_type = 'raw_material'
  group by product.id, product.current_stock, product.created_at
), combined as (
  select * from opening where change <> 0
  union all
  select events.* from events join public.products product on product.id = events.product_id and product.product_type = 'raw_material'
)
select product_id, change,
       sum(change) over (partition by product_id order by created_at, kind <> 'Opening balance', change rows unbounded preceding),
       kind, reference, true, created_at
from combined
where not exists (select 1 from public.stock_ledger)
order by created_at;

alter table public.stock_ledger enable row level security;
drop policy if exists stock_ledger_read on public.stock_ledger;
create policy stock_ledger_read on public.stock_ledger for select to authenticated using (true);
revoke all on public.stock_ledger from anon;
revoke insert, update, delete, truncate on public.stock_ledger from authenticated;
grant select on public.stock_ledger to authenticated;

revoke execute on function public.set_stock_reason(text, text) from public, anon, authenticated;
revoke execute on function public.label_inventory_movement_change() from public, anon, authenticated;
revoke execute on function public.label_sale_usage() from public, anon, authenticated;
revoke execute on function public.record_stock_ledger() from public, anon, authenticated;
grant execute on function public.set_sale_status(uuid, text) to authenticated;
revoke execute on function public.set_sale_status(uuid, text) from public, anon;

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_ledger') then
    alter publication supabase_realtime add table public.stock_ledger;
  end if;
end;
$$;

commit;
