begin;
create view public.captacoes_recentes with (security_invoker = true) as
select distinct on (codigo_condominio) codigo_condominio, condominio, captado_em
from public.captacoes
order by codigo_condominio, captado_em desc;
revoke all on public.captacoes_recentes from public, anon, authenticated;
grant select on public.captacoes_recentes to authenticated;
commit;
