begin;

-- Relabelling g as kg does not convert existing numbers or historical snapshots.
create or replace function public.preserve_inventory_unit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if lower(trim(new.unit)) = lower(trim(old.unit)) then return new; end if;
  if old.current_stock <> 0 or old.cost_baseline_quantity <> 0
    or exists(select 1 from public.inventory_movements where product_id=old.id)
    or exists(select 1 from public.sale_ingredient_usage where ingredient_id=old.id)
    or exists(select 1 from public.product_recipes where ingredient_id=old.id or finished_product_id=old.id)
    or exists(select 1 from public.sale_items where product_id=old.id) then
    raise exception 'Inventory unit cannot change after stock, recipes or transactions exist. Keep the inventory unit and select the delivery unit when adding stock.';
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_inventory_unit on public.products;
create trigger preserve_inventory_unit before update of unit on public.products
for each row execute function public.preserve_inventory_unit();
revoke execute on function public.preserve_inventory_unit() from public, anon, authenticated;
commit;
