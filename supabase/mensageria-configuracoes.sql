create table public.mensageria_opcoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('regua', 'modelo', 'smtp')),
  nome text not null check (length(trim(nome)) between 1 and 120),
  dados jsonb not null check (jsonb_typeof(dados) = 'object'),
  unique (tipo, nome)
);
alter table public.mensageria_opcoes enable row level security;
revoke all on public.mensageria_opcoes from anon, authenticated;
grant select, insert, update, delete on public.mensageria_opcoes to authenticated;
create policy gerenciar_mensageria on public.mensageria_opcoes for all to authenticated
  using ((select espelho_privado.admin())) with check ((select espelho_privado.admin()));
create policy ler_mensageria on public.mensageria_opcoes for select to authenticated
  using (exists (select 1 from public.espelho_usuarios u
    where u.id = (select auth.uid()) and 'mensageria' = any(u.modulos)));

create function public.mensageria_carteiras()
returns table (carteira_id uuid, nome text, condominio_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.id, c.nome, cc.condominio_id
  from public.espelho_carteiras c
  join public.espelho_carteiras_condominios cc on cc.carteira_id = c.id
  join public.espelho_usuarios u on u.id = (select auth.uid())
  where u.administrador or ('mensageria' = any(u.modulos)
    and (u.todas_carteiras or exists (select 1 from public.espelho_usuarios_carteiras uc
      where uc.usuario_id = u.id and uc.carteira_id = c.id)));
$$;
revoke all on function public.mensageria_carteiras() from public, anon;
grant execute on function public.mensageria_carteiras() to authenticated;
