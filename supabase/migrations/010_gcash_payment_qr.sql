begin;

-- Only bounded PNG images or the bundled initial QR may be displayed as payment QR.
create or replace function public.valid_payment_qr_image(p_image text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare v_png bytea; v_width bigint; v_height bigint;
begin
  if p_image is null or p_image = '/gcash-qr.png' then return true; end if;
  if length(p_image) > 400000 or p_image !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  v_png := decode(substr(p_image, 23), 'base64');
  if octet_length(v_png) < 33 or encode(substring(v_png from 1 for 8), 'hex') <> '89504e470d0a1a0a'
    or encode(substring(v_png from 13 for 4), 'hex') <> '49484452' then return false; end if;
  v_width := get_byte(v_png,16)::bigint*16777216 + get_byte(v_png,17)*65536 + get_byte(v_png,18)*256 + get_byte(v_png,19);
  v_height := get_byte(v_png,20)::bigint*16777216 + get_byte(v_png,21)*65536 + get_byte(v_png,22)*256 + get_byte(v_png,23);
  return v_width between 128 and 1024 and v_height between 128 and 1024;
exception when others then return false;
end;
$$;

create table if not exists public.payment_settings (
  id boolean primary key default true check (id),
  gcash_qr_image text default '/gcash-qr.png' check (public.valid_payment_qr_image(gcash_qr_image)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.payment_settings(id) values(true) on conflict(id) do nothing;
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from public, anon, authenticated;
grant select on public.payment_settings to authenticated;
drop policy if exists payment_settings_workspace_read on public.payment_settings;
create policy payment_settings_workspace_read on public.payment_settings for select to authenticated
using (exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','staff')));

create or replace function public.set_gcash_payment_qr(p_image text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if not public.valid_payment_qr_image(p_image) then raise exception 'Use a valid cropped PNG QR image.'; end if;
  update public.payment_settings set gcash_qr_image=p_image, updated_at=now(), updated_by=auth.uid() where id=true;
  if not found then raise exception 'Payment settings are not configured.'; end if;
end;
$$;
revoke execute on function public.set_gcash_payment_qr(text) from public, anon;
grant execute on function public.set_gcash_payment_qr(text) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='payment_settings') then
    alter publication supabase_realtime add table public.payment_settings;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
