alter table public.espelho_usuarios add column todas_carteiras boolean not null default false;

with origem (id, nome) as (
  values
    ('f2794994-c616-4a17-9a5c-fd44aa9d906c'::uuid, 'Azevedo Araújo'),
    ('36b6c087-56d2-4297-be63-6dcbe02a9f00'::uuid, 'Escritório Genske Adv'),
    ('e1f6e3ac-1098-4b30-9e0f-af4c47b351a3'::uuid, 'GEKALI'),
    ('06827218-e2b1-4267-ad8f-81a0ab222cad'::uuid, 'Genske Advogados')
)
insert into public.espelho_carteiras (id, nome)
select id, nome from origem
on conflict (nome) do nothing;

with origem (id, nome) as (
  values
    ('f2794994-c616-4a17-9a5c-fd44aa9d906c', 'Azevedo Araújo'),
    ('36b6c087-56d2-4297-be63-6dcbe02a9f00', 'Escritório Genske Adv'),
    ('e1f6e3ac-1098-4b30-9e0f-af4c47b351a3', 'GEKALI'),
    ('06827218-e2b1-4267-ad8f-81a0ab222cad', 'Genske Advogados')
)
insert into public.espelho_carteiras_condominios(carteira_id, condominio_id)
select ec.id, c.id
from public.condominios c
join origem o on o.id = c.cadastro ->> 'carteira_id'
join public.espelho_carteiras ec on ec.nome = o.nome
on conflict do nothing;

create or replace function espelho_privado.condominios_permitidos(modulos text[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cc.condominio_id
  from public.espelho_usuarios u
  join public.espelho_carteiras_condominios cc on u.todas_carteiras or exists (
    select 1 from public.espelho_usuarios_carteiras uc
    where uc.usuario_id = u.id and uc.carteira_id = cc.carteira_id
  )
  where u.id = (select auth.uid()) and u.modulos && $1;
$$;

create or replace function espelho_privado.salvar_acessos(usuario uuid, modulos text[], carteiras uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not espelho_privado.admin() then raise insufficient_privilege; end if;
  update public.espelho_usuarios u set modulos = salvar_acessos.modulos, todas_carteiras = false
    where u.id = usuario and not u.administrador;
  if not found then raise exception 'Usuário operacional não encontrado'; end if;
  delete from public.espelho_usuarios_carteiras where usuario_id = usuario;
  insert into public.espelho_usuarios_carteiras (usuario_id, carteira_id)
    select usuario, id from unnest(carteiras) as ids(id);
end
$$;

create function espelho_privado.salvar_acessos(usuario uuid, modulos text[], carteiras uuid[], todas_carteiras boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform espelho_privado.salvar_acessos(usuario, modulos, case when todas_carteiras then array[]::uuid[] else carteiras end);
  update public.espelho_usuarios u set todas_carteiras = salvar_acessos.todas_carteiras where u.id = usuario;
end
$$;

create function public.espelho_salvar_acessos(usuario uuid, modulos text[], carteiras uuid[], todas_carteiras boolean)
returns void language sql set search_path = '' as $$
  select espelho_privado.salvar_acessos(usuario, modulos, carteiras, todas_carteiras);
$$;

revoke all on function espelho_privado.salvar_acessos(uuid,text[],uuid[],boolean),
  public.espelho_salvar_acessos(uuid,text[],uuid[],boolean) from public, anon, authenticated;
grant execute on function espelho_privado.salvar_acessos(uuid,text[],uuid[],boolean),
  public.espelho_salvar_acessos(uuid,text[],uuid[],boolean) to authenticated;
