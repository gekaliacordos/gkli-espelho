begin;

create table public.espelho_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  administrador boolean not null default false,
  modulos text[] not null default '{}'
    check (modulos <@ array['cadastro', 'captacao', 'acordo', 'relatorios'])
);
create table public.espelho_carteiras (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(btrim(nome)) > 0)
);
create table public.espelho_carteiras_condominios (
  carteira_id uuid references public.espelho_carteiras(id) on delete cascade,
  condominio_id uuid references public.condominios(id) on delete cascade,
  primary key (carteira_id, condominio_id)
);
create table public.espelho_usuarios_carteiras (
  usuario_id uuid references public.espelho_usuarios(id) on delete cascade,
  carteira_id uuid references public.espelho_carteiras(id) on delete cascade,
  primary key (usuario_id, carteira_id)
);
create index on public.espelho_carteiras_condominios (condominio_id);

insert into public.espelho_usuarios (id, email, administrador)
select id, email, true from auth.users
where id = '99b65524-1b1d-4f47-b6b9-09d59dca009a';
do $$
begin
  if not exists (select 1 from public.espelho_usuarios where administrador) then
    raise exception 'Conta administradora original não encontrada';
  end if;
end
$$;

create schema espelho_privado;
revoke all on schema espelho_privado from public;
grant usage on schema espelho_privado to authenticated;

create function espelho_privado.admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.espelho_usuarios where id = (select auth.uid()) and administrador
  );
$$;
revoke all on function espelho_privado.admin() from public;
grant execute on function espelho_privado.admin() to authenticated;

do $$
declare tabela text;
begin
  foreach tabela in array array['espelho_usuarios', 'espelho_carteiras',
    'espelho_carteiras_condominios', 'espelho_usuarios_carteiras']
  loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all on public.%I from public, anon, authenticated', tabela);
    execute format('grant select on public.%I to authenticated', tabela);
    execute format('create policy ler_admin on public.%I for select to authenticated using ((select espelho_privado.admin()))', tabela);
  end loop;
end
$$;

grant select, insert on public.espelho_usuarios to service_role;
grant insert on public.espelho_carteiras to authenticated;
create policy ler_proprio on public.espelho_usuarios for select to authenticated using (id = (select auth.uid()));
create policy criar_carteira on public.espelho_carteiras for insert to authenticated with check ((select espelho_privado.admin()));

-- A substituição de cada conjunto acontece numa transação e serializa edições do mesmo registro.
create function espelho_privado.salvar_acessos(usuario uuid, modulos text[], carteiras uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not espelho_privado.admin() then raise insufficient_privilege; end if;
  update public.espelho_usuarios u set modulos = salvar_acessos.modulos
    where u.id = usuario and not u.administrador;
  if not found then raise exception 'Usuário operacional não encontrado'; end if;
  delete from public.espelho_usuarios_carteiras where usuario_id = usuario;
  insert into public.espelho_usuarios_carteiras (usuario_id, carteira_id)
    select usuario, id from unnest(carteiras) as ids(id);
end
$$;
create function espelho_privado.salvar_carteira(carteira uuid, condominios uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not espelho_privado.admin() then raise insufficient_privilege; end if;
  perform 1 from public.espelho_carteiras where id = carteira for update;
  if not found then raise exception 'Carteira não encontrada'; end if;
  delete from public.espelho_carteiras_condominios where carteira_id = carteira;
  insert into public.espelho_carteiras_condominios (carteira_id, condominio_id)
    select carteira, id from unnest(condominios) as ids(id);
end
$$;
create function public.espelho_salvar_acessos(usuario uuid, modulos text[], carteiras uuid[]) returns void
language sql set search_path = '' as $$ select espelho_privado.salvar_acessos(usuario, modulos, carteiras); $$;
create function public.espelho_salvar_carteira(carteira uuid, condominios uuid[]) returns void
language sql set search_path = '' as $$ select espelho_privado.salvar_carteira(carteira, condominios); $$;

create function espelho_privado.condominios_permitidos(modulos text[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cc.condominio_id from public.espelho_usuarios u
  join public.espelho_usuarios_carteiras uc on uc.usuario_id = u.id
  join public.espelho_carteiras_condominios cc on cc.carteira_id = uc.carteira_id
  where u.id = (select auth.uid()) and u.modulos && $1;
$$;
create function espelho_privado.condominio_da_captacao(adm text, codigo_captado text) returns uuid
language sql stable security definer set search_path = '' as $$
  select (array_agg(a.condominio_id))[1] from public.espelhamento_alvos a
  where a.codigo = codigo_captado and lower(a.administradora) = lower(adm)
  having count(*) = 1;
$$;
revoke all on function espelho_privado.salvar_acessos(uuid,text[],uuid[]),
  espelho_privado.salvar_carteira(uuid,uuid[]), public.espelho_salvar_acessos(uuid,text[],uuid[]),
  public.espelho_salvar_carteira(uuid,uuid[]), espelho_privado.condominios_permitidos(text[]),
  espelho_privado.condominio_da_captacao(text,text) from public, anon, authenticated;
grant execute on function espelho_privado.salvar_acessos(uuid,text[],uuid[]),
  espelho_privado.salvar_carteira(uuid,uuid[]), public.espelho_salvar_acessos(uuid,text[],uuid[]),
  public.espelho_salvar_carteira(uuid,uuid[]), espelho_privado.condominios_permitidos(text[]),
  espelho_privado.condominio_da_captacao(text,text) to authenticated;

alter policy ler_condominios_gkli on public.condominios using (
  (select espelho_privado.admin()) or id in (
    select espelho_privado.condominios_permitidos(array['cadastro','acordo','relatorios'])
  )
);
alter policy ler_captacoes_gkli on public.captacoes using (
  (select espelho_privado.admin()) or
  espelho_privado.condominio_da_captacao(administradora, codigo_condominio) in (
    select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios'])
  )
);
alter policy ler_administradoras_gkli on public.administradoras using (
  (select espelho_privado.admin()) or chave in (
    select administradora_chave from public.condominios where id in (
      select espelho_privado.condominios_permitidos(array['cadastro','captacao','acordo','relatorios'])
    )
  ) or chave in (select administradora_chave from public.captacoes)
);
-- As credenciais dos portais continuam restritas ao administrador.
alter policy ler_acessos_gkli on public.condominio_acessos using ((select espelho_privado.admin()));
commit;
