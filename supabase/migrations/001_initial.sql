create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  role text not null default 'staff' check (role in ('admin', 'staff')),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  category_id uuid not null references public.categories(id) on delete restrict,
  unit text not null check (char_length(unit) between 1 and 12),
  current_stock numeric(15,3) not null default 0 check (current_stock >= 0),
  low_stock_threshold numeric(15,3) not null default 0 check (low_stock_threshold >= 0),
  price_centavos bigint not null default 0 check (price_centavos >= 0),
  image_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(15,3) not null check (quantity > 0),
  note text not null default '' check (char_length(note) <= 160),
  movement_date date not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt text not null unique,
  business_date date not null,
  payment_method text not null check (payment_method in ('Cash', 'GCash', 'Maya')),
  status text not null default 'Completed' check (status in ('Completed', 'Cancelled')),
  total_centavos bigint not null check (total_centavos >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_centavos bigint not null check (unit_price_centavos >= 0),
  line_total_centavos bigint not null check (line_total_centavos >= 0)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('low_stock', 'out_of_stock')),
  severity text not null check (severity in ('warning', 'danger')),
  title text not null,
  message text not null,
  product_id uuid references public.products(id) on delete cascade,
  dedupe_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_inventory_product_date on public.inventory_movements(product_id, movement_date desc);
create index if not exists idx_sales_date_status on public.sales(business_date, status);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_notifications_active_created on public.notifications(active, created_at desc);
create unique index if not exists idx_notifications_active_dedupe on public.notifications(dedupe_key) where active;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'Staff'), '@', 1)),
    'staff'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

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
  if v_product.current_stock > v_product.low_stock_threshold then
    if v_active_id is not null then
      update public.notifications set active = false, resolved_at = now() where id = v_active_id;
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

create or replace function public.products_alert_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_inventory_alert(new.id);
  return new;
end;
$$;

drop trigger if exists products_inventory_alert on public.products;
create trigger products_inventory_alert after insert or update of current_stock, low_stock_threshold on public.products
for each row execute function public.products_alert_trigger();

create or replace function public.add_stock(p_product_id uuid, p_quantity numeric, p_date date, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  perform 1 from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  insert into public.inventory_movements(id, product_id, quantity, note, movement_date, created_by)
  values(v_id, p_product_id, round(p_quantity, 3), coalesce(p_note, ''), p_date, auth.uid());
  update public.products set current_stock = current_stock + round(p_quantity, 3), updated_at = now() where id = p_product_id;
  return v_id;
end;
$$;

create or replace function public.update_stock_entry(p_id uuid, p_quantity numeric, p_date date, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_movement public.inventory_movements%rowtype; v_next numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_movement from public.inventory_movements where id = p_id for update;
  if not found then raise exception 'Inventory entry not found'; end if;
  select current_stock - v_movement.quantity + round(p_quantity, 3) into v_next from public.products where id = v_movement.product_id for update;
  if p_quantity is null or p_quantity <= 0 or v_next < 0 then raise exception 'Invalid stock adjustment'; end if;
  update public.inventory_movements set quantity = round(p_quantity, 3), movement_date = p_date, note = coalesce(p_note, ''), updated_at = now() where id = p_id;
  update public.products set current_stock = v_next, updated_at = now() where id = v_movement.product_id;
  return p_id;
end;
$$;

create or replace function public.delete_stock_entry(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_movement public.inventory_movements%rowtype; v_stock numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_movement from public.inventory_movements where id = p_id for update;
  if not found then raise exception 'Inventory entry not found'; end if;
  select current_stock into v_stock from public.products where id = v_movement.product_id for update;
  if v_stock - v_movement.quantity < 0 then raise exception 'Some of this stock has already been used'; end if;
  delete from public.inventory_movements where id = p_id;
  update public.products set current_stock = current_stock - v_movement.quantity, updated_at = now() where id = v_movement.product_id;
end;
$$;

create or replace function public.create_sale(p_payment text, p_items jsonb)
returns table(id uuid, receipt text, total_centavos bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_receipt text := 'RC-' || to_char(timezone('Asia/Manila', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_total bigint := 0;
  v_item record;
  v_product public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_payment not in ('Cash', 'GCash', 'Maya') then raise exception 'Invalid payment method'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'An order needs at least one item'; end if;
  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Invalid item quantity'; end if;
    select * into v_product from public.products where products.id = v_item.product_id and active for update;
    if not found then raise exception 'Product is unavailable'; end if;
    if v_product.current_stock < v_item.quantity then raise exception '% only has % remaining', v_product.name, v_product.current_stock; end if;
    v_total := v_total + (v_product.price_centavos * v_item.quantity);
  end loop;
  insert into public.sales(id, receipt, business_date, payment_method, total_centavos, created_by)
  values(v_id, v_receipt, (timezone('Asia/Manila', now()))::date, p_payment, v_total, auth.uid());
  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  loop
    select * into v_product from public.products where products.id = v_item.product_id for update;
    insert into public.sale_items(sale_id, product_id, product_name, quantity, unit_price_centavos, line_total_centavos)
    values(v_id, v_product.id, v_product.name, v_item.quantity, v_product.price_centavos, v_product.price_centavos * v_item.quantity);
    update public.products set current_stock = current_stock - v_item.quantity, updated_at = now() where products.id = v_product.id;
  end loop;
  return query select v_id, v_receipt, v_total;
end;
$$;

create or replace function public.set_sale_status(p_sale_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_sale public.sales%rowtype; v_item record; v_stock numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('Completed', 'Cancelled') then raise exception 'Invalid sale status'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = p_status then return; end if;
  if p_status = 'Cancelled' then
    for v_item in select * from public.sale_items where sale_id = p_sale_id loop
      update public.products set current_stock = current_stock + v_item.quantity, updated_at = now() where id = v_item.product_id;
    end loop;
    update public.sales set status = 'Cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = p_sale_id;
  else
    for v_item in select * from public.sale_items where sale_id = p_sale_id loop
      select current_stock into v_stock from public.products where id = v_item.product_id for update;
      if v_stock < v_item.quantity then raise exception '% does not have enough stock', v_item.product_name; end if;
      update public.products set current_stock = current_stock - v_item.quantity, updated_at = now() where id = v_item.product_id;
    end loop;
    update public.sales set status = 'Completed', cancelled_by = null, cancelled_at = null where id = p_sale_id;
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update(display_name, avatar_path, updated_at) on public.profiles to authenticated;

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (true);
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists inventory_read on public.inventory_movements;
create policy inventory_read on public.inventory_movements for select to authenticated using (true);
drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (true);
drop policy if exists sale_items_read on public.sale_items;
create policy sale_items_read on public.sale_items for select to authenticated using (true);
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (true);
drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists avatars_own_insert on storage.objects;
create policy avatars_own_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

grant execute on function public.add_stock(uuid, numeric, date, text) to authenticated;
grant execute on function public.update_stock_entry(uuid, numeric, date, text) to authenticated;
grant execute on function public.delete_stock_entry(uuid) to authenticated;
grant execute on function public.create_sale(text, jsonb) to authenticated;
grant execute on function public.set_sale_status(uuid, text) to authenticated;
revoke execute on function public.add_stock(uuid, numeric, date, text) from public, anon;
revoke execute on function public.update_stock_entry(uuid, numeric, date, text) from public, anon;
revoke execute on function public.delete_stock_entry(uuid) from public, anon;
revoke execute on function public.create_sale(text, jsonb) from public, anon;
revoke execute on function public.set_sale_status(uuid, text) from public, anon;
revoke execute on function public.sync_inventory_alert(uuid) from public, anon, authenticated;
revoke execute on function public.products_alert_trigger() from public, anon, authenticated;
