begin;

create function public.chave_administradora(nome text) returns text
language sql immutable strict set search_path = ''
as $$
  select case chave
    when 'thomaz' then 'thomazmulti'
    when 'donewndgestaoadminsitrativa' then 'donew'
    when 'donewndgestaoadministrativa' then 'donew'
    else chave
  end
  from (select regexp_replace(
    translate(lower(btrim(nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]+', '', 'g'
  ) as chave) normalizado;
$$;

create table public.administradoras (
  chave text primary key check (chave <> ''),
  nome text not null check (btrim(nome) <> ''),
  nome_operacional text not null check (btrim(nome_operacional) <> ''),
  gkli_id uuid unique,
  cadastro jsonb not null default '{}'::jsonb check (jsonb_typeof(cadastro) = 'object')
);

alter table public.administradoras enable row level security;
revoke all on public.administradoras from public, anon, authenticated;
grant select on public.administradoras to authenticated;
grant select, insert, update on public.administradoras to service_role;
create policy ler_administradoras_gkli on public.administradoras
  for select to authenticated
  using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);

alter table public.condominios add column administradora_chave text references public.administradoras(chave);
alter table public.captacoes add column administradora_chave text references public.administradoras(chave);
create index condominios_administradora_chave on public.condominios (administradora_chave);
create index captacoes_por_administradora_condominio on public.captacoes
  (administradora_chave, codigo_condominio, captado_em desc, id desc);

create function public.resolver_administradora(nome_origem text, gkli_id_origem text default null) returns text
language plpgsql set search_path = ''
as $$
declare
  chave_origem text := nullif(public.chave_administradora(nome_origem), '');
  encontrada text;
begin
  if gkli_id_origem ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select a.chave into encontrada from public.administradoras a where a.gkli_id = gkli_id_origem::uuid;
    if encontrada is not null then return encontrada; end if;
  end if;
  if chave_origem is null then return null; end if;

  select a.chave into encontrada from public.administradoras a
  where a.chave = chave_origem or public.chave_administradora(a.nome) = chave_origem
  order by (a.gkli_id is not null) desc, (a.chave = chave_origem) desc, a.chave limit 1;
  if encontrada is not null then return encontrada; end if;

  insert into public.administradoras(chave, nome, nome_operacional)
    values (chave_origem, btrim(nome_origem), btrim(nome_origem)) on conflict (chave) do nothing;
  return chave_origem;
end;
$$;

create function public.vincular_administradora_condominio() returns trigger
language plpgsql set search_path = ''
as $$
declare nome_acesso text;
begin
  select a.administradora into nome_acesso from public.condominio_acessos a where a.condominio_id = new.id;
  new.administradora_chave := public.resolver_administradora(
    coalesce(nullif(btrim(new.cadastro->>'administradora'), ''), nome_acesso),
    nullif(new.cadastro->>'administradora_id', '')
  );
  return new;
end;
$$;

create function public.vincular_administradora_acesso() returns trigger
language plpgsql set search_path = ''
as $$
begin
  update public.condominios set cadastro = cadastro
  where id = new.condominio_id and nullif(btrim(cadastro->>'administradora'), '') is null;
  return new;
end;
$$;

create function public.vincular_administradora_captacao() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.administradora_chave := public.resolver_administradora(new.administradora);
  return new;
end;
$$;

revoke all on function public.resolver_administradora(text, text), public.vincular_administradora_condominio(),
  public.vincular_administradora_acesso(), public.vincular_administradora_captacao() from public, anon, authenticated;
grant execute on function public.resolver_administradora(text, text), public.vincular_administradora_condominio(),
  public.vincular_administradora_acesso(), public.vincular_administradora_captacao() to service_role;

create trigger condominios_vincular_administradora before insert or update of cadastro on public.condominios
  for each row execute function public.vincular_administradora_condominio();
create trigger acessos_vincular_administradora after insert or update of administradora on public.condominio_acessos
  for each row execute function public.vincular_administradora_acesso();
create trigger captacoes_vincular_administradora before insert or update of administradora on public.captacoes
  for each row execute function public.vincular_administradora_captacao();

update public.condominios set cadastro = cadastro;
update public.captacoes set administradora = administradora;

create view public.captacoes_por_administradora with (security_invoker = true) as
select distinct on (administradora_chave, codigo_condominio)
  id, codigo_condominio, condominio, captado_em, administradora, administradora_chave
from public.captacoes where administradora_chave is not null
order by administradora_chave, codigo_condominio, captado_em desc, id desc;
revoke all on public.captacoes_por_administradora from public, anon, authenticated;
grant select on public.captacoes_por_administradora to authenticated;

commit;
