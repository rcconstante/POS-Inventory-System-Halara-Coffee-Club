-- Read-only endpoint used by the external Netlify scheduler to generate a
-- small amount of genuine database activity for Free Plan project pausing.
-- It deliberately reads no application data and performs no writes.

create or replace function public.project_keepalive()
returns timestamptz
language sql
volatile
set search_path = ''
as $$
  select clock_timestamp();
$$;

revoke all on function public.project_keepalive() from public;
grant execute on function public.project_keepalive() to anon, authenticated;
