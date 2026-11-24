begin;

alter table public.administradoras add column espelhamento_automatico boolean not null default true;
alter table public.condominios add column espelhamento_automatico boolean not null default true;

create table public.espelhamento_configuracao (
  unica boolean primary key default true check (unica),
  ativo boolean not null default false
);
insert into public.espelhamento_configuracao default values;
alter table public.espelhamento_configuracao enable row level security;
revoke all on public.espelhamento_configuracao from public, anon, authenticated;
grant select on public.espelhamento_configuracao to authenticated;
create policy espelhamento_configuracao_leitura on public.espelhamento_configuracao
  for select to authenticated using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);

create table public.espelhamento_alvos (
  codigo text primary key,
  administradora text not null references public.administradoras(chave),
  condominio_id uuid not null references public.condominios(id)
);
alter table public.espelhamento_alvos enable row level security;
revoke all on public.espelhamento_alvos from public, anon, authenticated;
grant select on public.espelhamento_alvos to authenticated;
create policy espelhamento_alvos_leitura on public.espelhamento_alvos
  for select to authenticated using ((select auth.uid()) = '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid);

insert into public.espelhamento_alvos (administradora, codigo, condominio_id)
select a.administradora, a.codigo, c.id
from (values
    ('lello', '63004', 'SAFIRA'),
    ('lello', '182', 'CONDOMINIO BOSQUE MARAJOARA'),
    ('lello', '3839', 'CONDOMINIO EDIFICIO SOLAR DOS BANDEIRANTES'),
    ('lello', '8272', 'CONDOMINIO EDIFICIO TOUR DE LION'),
    ('lello', '1637', 'CONDOMINIO RESIDENCIAL INSPIRE MAUA SONHOS'),
    ('lello', '62430', 'FOLLOW - THE EUREKA BUILDING'),
    ('lello', '8334', 'HARMONIA MORUMBI RESIDENCE'),
    ('lello', '62905', 'CO. NEXT LIBERDADE'),
    ('lello', '8759', 'VN CASA TOPAZIO'),
    ('lello', '62751', 'VILLA NATURA'),
    ('bbz', 'bbz-1380', 'CONDOMINIO COMODITA CLUB RESIDENCE'),
    ('bbz', 'bbz-650', 'CONDOMINIO EDIFICIO ESTACAO GABRIELE'),
    ('bbz', 'bbz-1207', 'CONDOMINIO EXTENSION BERRINI'),
    ('bbz', 'bbz-1532', 'PANORAMA VILA ROMANA'),
    ('bbz', 'bbz-1158', 'CONDOMÍNIO ELO & ELO DUO CAMINHOS DA LAPA SETOR 3 RESIDENCIAL TORRE B'),
    ('bbz', 'bbz-1843', 'CONDOMÍNIO BEM MOEMA - SETOR COMERCIAL'),
    ('bbz', 'bbz-1844', 'CONDOMÍNIO BEM MOEMA - SETOR LOJAS'),
    ('bbz', 'bbz-1841', 'CONDOMÍNIO BEM MOEMA - SETOR RESIDENCIAL'),
    ('bbz', 'bbz-1842', 'CONDOMÍNIO BEM MOEMA - SETOR STUDIOS'),
    ('bbz', 'bbz-1792', 'CONDOMINIO EDIFICIO L AVANCE MORUMBI'),
    ('bbz', 'bbz-728', 'CONDOMINIO WEST SIDE'),
    ('bbz', 'bbz-1869', 'HI VIEW ALTO DA BOA VISTA - SETOR RESIDENCIAL'),
    ('bbz', 'bbz-1838', 'CONDOMÍNIO K360º HUMBERTO I COMERCIAL'),
    ('bbz', 'bbz-1837', 'CONDOMÍNIO K360º HUMBERTO I-RESIDENCIAL'),
    ('bbz', 'bbz-1680', 'LIVING WELLNESS ACLIMACAO'),
    ('bbz', 'bbz-1681', 'LIVING WELLNESS ACLIMACAO'),
    ('bbz', 'bbz-1682', 'LIVING WELLNESS ACLIMACAO'),
    ('bbz', 'bbz-1683', 'LIVING WELLNESS ACLIMACAO'),
    ('bbz', 'bbz-1679', 'LIVING WELLNESS ACLIMACAO'),
    ('bbz', 'bbz-1341', 'CONDOMINIO EDIFICIO VIVAZ VILA PRUDENTE'),
    ('manager', 'manager-626', 'CONDOMÍNIO ALPHA STAY'),
    ('manager', 'manager-2355', 'CONDOMINIO ALPHAVILLE TRES PRAIAS - RESIDENCIAL 3'),
    ('manager', 'manager-656', 'CONDOMINIO CADIZ - JARDIM PRUDENCIA'),
    ('manager', 'manager-519', 'CONDOMÍNIO COSMOPOLITAN HIGH GARDEN'),
    ('manager', 'manager-664', 'CONDOMÍNIO CYRELA IBIRAPUERA BY YOO - MEDPLEX'),
    ('manager', 'manager-661', 'CONDOMÍNIO CYRELA IBIRAPUERA BY YOO - SETOR RESIDENCIAL 1'),
    ('manager', 'manager-663', 'CONDOMÍNIO CYRELA IBIRAPUERA BY YOO - SETOR RESIDENCIAL 2'),
    ('manager', 'manager-580', 'CONDOMINIO EDIFICIO CACIQUE'),
    ('manager', 'manager-2318', 'CONDOMÍNIO EDIFÍCIO GUAJARÁ'),
    ('manager', 'manager-761', 'CONDOMINIO EDIFICIO IMPERIAL BERRINI OFFICES'),
    ('manager', 'manager-2065', 'CONDOMINIO EDIFICIO MAISON D'' ORSAY'),
    ('manager', 'manager-2262', 'CONDOMINIO EDIFICIO OASIS'),
    ('manager', 'manager-2206', 'CONDOMINIO EDIFICIO SAO MANUEL'),
    ('manager', 'manager-2272', 'CONDOMINIO NEW WAY'),
    ('manager', 'manager-2144', 'CONDOMINIO PROJECT HOME'),
    ('manager', 'manager-458', 'CONDOMINIO RAIZES DA MATA'),
    ('manager', 'manager-695', 'CONDOMÍNIO SQUARE GARDEN CAMPO BELO - RESIDENCIAL'),
    ('manager', 'manager-567', 'CONDOMÍNIO VILLA LOBOS OFFICE PARK'),
    ('manager', 'manager-575', 'EDIFÍCIO CAROLINE MAHAL'),
    ('manager', 'manager-582', 'ESTILO GRANJA VIANA CONDOMINIO E CLUBE'),
    ('manager', 'manager-2280', 'HELVETIA GRAND QUARTIER - GARTEN HAUS CONDOMINIUM'),
    ('manager', 'manager-860', 'RESERVA BUTANTA'),
    ('manager', 'manager-750', 'RESIDENCIAL VIEW BUTANTA'),
    ('manager', 'manager-115', 'SOCIEDADE CIVIL DOS AMIGOS DO RESIDENCIAL MORUMBI'),
    ('habitacional', 'habitacional-3118', 'CONDOMINIO RESIDENCIAL MAIS ESTILO & DESIGN MORUMBI'),
    ('habitacional', 'habitacional-3145', 'CONDOMINIO RESIDENCIAL METROCASA MORUMBI'),
    ('habitacional', 'habitacional-3132', 'IL FARO'),
    ('graiche', 'graiche-jerivas', 'CAMINHOS DA LAPA CONDOMINIO JERIVAS'),
    ('hflex', 'hflex', 'CONDOMÍNIO ESCRITÓRIO RIO NEGRO'),
    ('hflex', 'hflex-5987', 'SUBCONDOMINIO EDIFICIO OFFICE TAMBORE'),
    ('oma', 'oma-22785', 'VISO MOEMA'),
    ('atipass', 'atipass', 'CONDOMINIO RESIDENCIAL DAS ILHAS'),
    ('villagua', 'villagua', 'CONDOMINIO SQUARE GUARULHOS')
) as a(administradora, codigo, condominio)
join public.condominios c on c.nome = a.condominio and c.administradora_chave = a.administradora and c.status = 'ativo';

create function public.configurar_espelhamento(escopo text, chave text, ativo boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is distinct from '99b65524-1b1d-4f47-b6b9-09d59dca009a'::uuid then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if ativo is null then raise exception 'Estado obrigatório'; end if;
  if escopo = 'geral' and chave is null then
    update public.espelhamento_configuracao set ativo = configurar_espelhamento.ativo where unica;
  elsif escopo = 'administradora' then
    update public.administradoras a set espelhamento_automatico = ativo where a.chave = configurar_espelhamento.chave;
  elsif escopo = 'condominio' then
    update public.condominios set espelhamento_automatico = ativo where id = chave::uuid;
  else
    raise exception 'Escopo inválido';
  end if;
  if not found then raise exception 'Cadastro não encontrado'; end if;
  return ativo;
end;
$$;
revoke all on function public.configurar_espelhamento(text,text,boolean) from public, anon, authenticated;
grant execute on function public.configurar_espelhamento(text,text,boolean) to authenticated;

create function public.espelhamento_pendentes()
returns table (portal text, codigo text)
language sql stable security definer set search_path = ''
as $$
  with hoje as (
    select (current_timestamp at time zone 'America/Sao_Paulo')::date as dia
  ), candidatos as (
    select a.administradora, a.codigo,
           case when c.cadastro->>'vencimento_cota_dia' ~ '^0?([1-9]|[12][0-9]|3[01])$'
                then (c.cadastro->>'vencimento_cota_dia')::int end as dia
    from public.espelhamento_alvos a
    join public.condominios c on c.id = a.condominio_id and c.administradora_chave = a.administradora
    join public.administradoras d on d.chave = a.administradora
    where c.status = 'ativo' and c.espelhamento_automatico and d.espelhamento_automatico
      and exists (select 1 from public.espelhamento_configuracao where unica and ativo)
  ), vencimentos as (
    select c.administradora, c.codigo, max(v.dia) as vencimento
    from candidatos c cross join hoje h
    cross join lateral (values
      (date_trunc('month', h.dia)::date),
      ((date_trunc('month', h.dia) - interval '1 month')::date)
    ) as m(inicio)
    cross join lateral (select least(m.inicio + c.dia - 1, (m.inicio + interval '1 month - 1 day')::date) as dia) v
    where c.dia is not null and v.dia < h.dia
    group by c.administradora, c.codigo
  )
  select v.administradora, v.codigo
  from vencimentos v
  cross join lateral (select ((v.vencimento + 1)::timestamp at time zone 'America/Sao_Paulo') as inicio) p
  where not exists (
    select 1 from public.captacoes c
    where c.codigo_condominio = v.codigo and c.administradora_chave = v.administradora and c.captado_em >= p.inicio
      and case
        when v.administradora in ('lello','hflex') then true
        when v.administradora = 'oma' then (c.dados->>'cotasCaptadasEm')::timestamptz >= p.inicio
        else (c.dados->>'cotasCaptadasEm')::timestamptz >= p.inicio
         and (c.dados->>'acordosCaptadosEm')::timestamptz >= p.inicio
      end
  )
  order by v.administradora, v.codigo
$$;
revoke all on function public.espelhamento_pendentes() from public, anon, authenticated;
grant execute on function public.espelhamento_pendentes() to gkli_coletores_runner;

commit;
