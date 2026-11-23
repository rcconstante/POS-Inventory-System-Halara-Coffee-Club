-- Prevent a cash refund from making the drawer's expected cash negative.
-- Same set_sale_status as 013, plus the drawer check before stock is restored.

begin;

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
    select status into v_shift_status from public.cash_shifts where id = v_sale.cash_shift_id for update;
    if v_shift_status = 'Closed' then raise exception 'Cash sales from a closed shift cannot be changed'; end if;
  end if;
  if not exists(select 1 from public.sale_ingredient_usage where sale_id = p_sale_id) and exists(select 1 from public.sale_items where sale_id = p_sale_id and tracks_inventory) then raise exception 'This legacy tracked sale has no ingredient-usage record and cannot safely change status'; end if;
  -- A cash refund pays money out of the drawer; it cannot exceed the cash expected
  -- in the drawer, or the shift could never be closed (expected_cash_centavos >= 0).
  if p_status = 'Cancelled' and v_sale.payment_method = 'Cash' and v_sale.cash_shift_id is not null
     and public.cash_shift_expected(v_sale.cash_shift_id) < v_sale.total_centavos then
    raise exception 'The drawer does not have enough cash to refund this sale. Record a Cash In first.';
  end if;
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

grant execute on function public.set_sale_status(uuid, text) to authenticated;
revoke execute on function public.set_sale_status(uuid, text) from public, anon;

commit;
