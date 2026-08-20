-- Allow menu details and client-supplied photos to be saved before a recipe is
-- configured. create_sale still rejects recipe-less products, so drafts cannot
-- bypass ingredient inventory deductions.

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


