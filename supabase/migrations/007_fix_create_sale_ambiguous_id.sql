-- Qualify product identifiers inside create_sale. The RPC returns a column named
-- `id`, which is also a PL/pgSQL output variable; unqualified table columns can
-- therefore raise "column reference id is ambiguous" at payment time.

create or replace function public.create_sale(
  p_payment text,
  p_items jsonb,
  p_cash_received_centavos bigint,
  p_client_reference uuid
)
returns table(id uuid, receipt text, total_centavos bigint, cash_received_centavos bigint, change_centavos bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_receipt text := 'RC-' || to_char(timezone('Asia/Manila', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_total bigint := 0;
  v_change bigint := null;
  v_item record;
  v_product public.products%rowtype;
  v_required numeric;
  v_shift public.cash_shifts%rowtype;
  v_cashier text;
  v_existing public.sales%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_client_reference is null then raise exception 'A payment submission reference is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_reference::text, 0));
  select sale.*
  into v_existing
  from public.sales sale
  where sale.client_reference = p_client_reference
    and sale.created_by = auth.uid();

  if found then
    return query
    select
      v_existing.id,
      v_existing.receipt,
      v_existing.total_centavos,
      v_existing.cash_received_centavos,
      v_existing.change_centavos;
    return;
  end if;

  if p_payment is null or p_payment not in ('Cash', 'GCash', 'Maya') then raise exception 'Invalid payment method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'An order needs at least one item'; end if;

  select shift.*
  into v_shift
  from public.cash_shifts shift
  where shift.opened_by = auth.uid()
    and shift.status = 'Open'
  for update;
  if not found then raise exception 'Open a cashier shift before processing a sale'; end if;
  v_cashier := v_shift.cashier_name;

  for v_item in
    select item.product_id, sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by item.product_id
    order by item.product_id
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Invalid item quantity'; end if;
    select product.*
    into v_product
    from public.products product
    where product.id = v_item.product_id
      and product.active
      and product.product_type = 'finished_product'
    for update;
    if not found then raise exception 'Sales item is unavailable'; end if;
    if v_product.tracks_inventory and not exists(
      select 1 from public.product_recipes recipe where recipe.finished_product_id = v_product.id
    ) then
      raise exception '% does not have a recipe or unit-stock mapping', v_product.name;
    end if;
    v_total := v_total + v_product.price_centavos * v_item.quantity;
  end loop;

  if p_payment = 'Cash' then
    if p_cash_received_centavos is null or p_cash_received_centavos < v_total then raise exception 'Cash received must cover the order total'; end if;
    v_change := p_cash_received_centavos - v_total;
  elsif p_cash_received_centavos is not null then
    raise exception 'Cash received is only valid for cash payments';
  end if;

  for v_item in
    with order_items as (
      select item.product_id, sum(item.quantity)::numeric as quantity
      from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
      group by item.product_id
    )
    select recipe.ingredient_id, sum(recipe.quantity * order_items.quantity) as required
    from order_items
    join public.products finished on finished.id = order_items.product_id and finished.tracks_inventory
    join public.product_recipes recipe on recipe.finished_product_id = order_items.product_id
    group by recipe.ingredient_id
    order by recipe.ingredient_id
  loop
    select ingredient.*
    into v_product
    from public.products ingredient
    where ingredient.id = v_item.ingredient_id
      and ingredient.active
      and ingredient.product_type = 'raw_material'
    for update;
    if not found then raise exception 'A recipe ingredient is unavailable'; end if;
    v_required := round(v_item.required, 3);
    if v_product.current_stock < v_required then
      raise exception '% only has % % remaining; % % is required',
        v_product.name, v_product.current_stock, v_product.unit, v_required, v_product.unit;
    end if;
  end loop;

  insert into public.sales(
    id, receipt, business_date, payment_method, total_centavos, created_by,
    cash_shift_id, cashier_name, cash_received_centavos, change_centavos,
    client_reference
  ) values (
    v_id, v_receipt, timezone('Asia/Manila', now())::date, p_payment, v_total,
    auth.uid(), v_shift.id, v_cashier,
    case when p_payment = 'Cash' then p_cash_received_centavos else null end,
    v_change, p_client_reference
  );

  for v_item in
    select item.product_id, sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by item.product_id
  loop
    select product.*
    into v_product
    from public.products product
    where product.id = v_item.product_id;

    insert into public.sale_items(
      sale_id, product_id, product_name, quantity, unit_price_centavos,
      line_total_centavos, tracks_inventory
    ) values (
      v_id, v_product.id, v_product.name, v_item.quantity,
      v_product.price_centavos, v_product.price_centavos * v_item.quantity,
      v_product.tracks_inventory
    );
  end loop;

  insert into public.sale_ingredient_usage(
    sale_id, ingredient_id, ingredient_name, quantity, unit
  )
  with order_items as (
    select item.product_id, sum(item.quantity)::numeric as quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by item.product_id
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
  where usage.sale_id = v_id
    and product.id = usage.ingredient_id;

  return query
  select
    v_id,
    v_receipt,
    v_total,
    case when p_payment = 'Cash' then p_cash_received_centavos else null end,
    v_change;
end;
$$;

grant execute on function public.create_sale(text, jsonb, bigint, uuid) to authenticated;
revoke execute on function public.create_sale(text, jsonb, bigint, uuid) from public, anon;
