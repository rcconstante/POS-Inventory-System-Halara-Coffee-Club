-- Client clarification: only Pastries and Pasta are excluded from inventory
-- deduction. Espresso Based, Not Coffee, Tea Refreshers and Soda, Add-ons, and
-- Sandwiches are recipe-tracked finished products.

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

  select category.name
  into v_category_name
  from public.categories category
  where category.id = new.category_id;

  if not found then
    raise exception 'Category not found';
  end if;

  new.tracks_inventory := v_category_name not in ('Pastries', 'Pasta');

  if tg_op = 'UPDATE' and old.tracks_inventory and not new.tracks_inventory then
    delete from public.product_recipes recipe
    where recipe.finished_product_id = new.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_product_inventory_scope() from public, anon, authenticated;

-- Correct every existing menu item. Sale-item snapshots are intentionally not
-- changed, so historical cancellations/restorations retain their original
-- inventory behavior.
update public.products product
set tracks_inventory = case
      when product.product_type = 'raw_material' then true
      when category.name in ('Pastries', 'Pasta') then false
      else true
    end,
    updated_at = now()
from public.categories category
where category.id = product.category_id;

-- Remove stale per-piece pastry recipes from the former rule. Pasta recipes are
-- also removed if any were manually configured before this clarification.
delete from public.product_recipes recipe
using public.products finished, public.categories category
where recipe.finished_product_id = finished.id
  and category.id = finished.category_id
  and category.name in ('Pastries', 'Pasta');

-- Retire the deterministic per-piece materials created by the former test seed
-- without deleting any historical usage rows that may reference them.
update public.products product
set active = false,
    updated_at = now()
where product.product_type = 'raw_material'
  and product.name like 'Pastry Stock - %';

update public.notifications notification
set active = false,
    resolved_at = coalesce(notification.resolved_at, now())
from public.products product
where notification.product_id = product.id
  and product.name like 'Pastry Stock - %'
  and notification.active;
