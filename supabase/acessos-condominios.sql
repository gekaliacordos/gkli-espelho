begin;
create table public.condominio_acessos (
  condominio_id uuid primary key references public.condominios(id),
  situacao text not null check (situacao in ('cadastrado', 'sem_acesso', 'nao_verificado')),
  administradora text,
  portal text,
  credenciais text,
  fonte text not null,
  check (situacao <> 'sem_acesso' or credenciais is null)
);
alter table public.condominio_acessos enable row level security;
revoke all on public.condominio_acessos from public, anon, authenticated;
grant select on public.condominio_acessos to authenticated;
create policy ler_acessos_gkli on public.condominio_acessos
  for select to authenticated
  using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);
commit;
