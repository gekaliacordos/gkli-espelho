begin;
alter table public.captacoes add column administradora text not null default 'Lello';
create or replace view public.captacoes_recentes with (security_invoker = true) as
select distinct on (codigo_condominio) codigo_condominio, condominio, captado_em, administradora
from public.captacoes
order by codigo_condominio, captado_em desc;
commit;
