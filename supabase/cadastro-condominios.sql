begin;

create table if not exists public.condominios (
  id uuid primary key,
  cadastro jsonb not null check (
    jsonb_typeof(cadastro) = 'object'
    and cadastro ->> 'id' is not null
    and (cadastro ->> 'id')::uuid = id
    and nullif(btrim(cadastro ->> 'nome'), '') is not null
  ),
  nome text generated always as (cadastro ->> 'nome') stored,
  administradora text generated always as (nullif(cadastro ->> 'administradora', '')) stored,
  status text generated always as (cadastro ->> 'status') stored
);

alter table public.condominios enable row level security;
revoke all on public.condominios from public, anon, authenticated;
grant select on public.condominios to authenticated;

create policy ler_condominios_gkli on public.condominios
  for select to authenticated
  using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);

commit;
