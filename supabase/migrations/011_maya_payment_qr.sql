begin;
alter table public.payment_settings add column if not exists maya_qr_image text
  check (maya_qr_image is null or (maya_qr_image <> '/gcash-qr.png' and public.valid_payment_qr_image(maya_qr_image)));

create or replace function public.set_payment_qr(p_method text, p_image text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_method is null or p_method not in ('GCash','Maya') then raise exception 'Select GCash or Maya.'; end if;
  if not public.valid_payment_qr_image(p_image) or (p_method='Maya' and p_image='/gcash-qr.png') then raise exception 'Use a valid cropped PNG QR image.'; end if;
  update public.payment_settings set
    gcash_qr_image=case when p_method='GCash' then p_image else gcash_qr_image end,
    maya_qr_image=case when p_method='Maya' then p_image else maya_qr_image end,
    updated_at=now(), updated_by=auth.uid() where id=true;
  if not found then raise exception 'Payment settings are not configured.'; end if;
end;
$$;
revoke execute on function public.set_payment_qr(text,text) from public, anon;
grant execute on function public.set_payment_qr(text,text) to authenticated;
drop function if exists public.set_gcash_payment_qr(text);
notify pgrst, 'reload schema';
commit;
