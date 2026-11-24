begin;

create table if not exists public.captacoes (
  id bigint generated always as identity primary key,
  codigo_condominio text not null,
  condominio text not null,
  captado_em timestamptz not null,
  dados jsonb not null,
  unique (codigo_condominio, captado_em)
);

alter table public.captacoes enable row level security;
revoke all on public.captacoes from public, anon, authenticated;
grant select on public.captacoes to authenticated;

drop policy if exists ler_captacoes_gkli on public.captacoes;
create policy ler_captacoes_gkli on public.captacoes
  for select to authenticated
  using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);

commit;
