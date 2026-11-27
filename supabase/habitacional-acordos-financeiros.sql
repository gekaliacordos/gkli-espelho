begin;

create table if not exists espelho_privado.habitacional_acordos_conferidos (
  codigo_condominio text not null check (codigo_condominio ~ '^habitacional-[0-9]+$'),
  unidade text not null check (unidade <> ''),
  numero text not null check (numero ~ '^[0-9]+$'),
  captacao_em timestamptz not null,
  conferido_em timestamptz not null check (conferido_em >= captacao_em),
  acordo jsonb check (jsonb_typeof(acordo) = 'object'),
  composicao jsonb check (jsonb_typeof(composicao) = 'object'),
  check ((acordo is null) = (composicao is null)),
  primary key (codigo_condominio, unidade, numero)
);

alter table espelho_privado.habitacional_acordos_conferidos enable row level security;
revoke all on espelho_privado.habitacional_acordos_conferidos from public, anon, authenticated;
grant select on espelho_privado.habitacional_acordos_conferidos to authenticated;
drop policy if exists ler_habitacional_acordos_conferidos on espelho_privado.habitacional_acordos_conferidos;
create policy ler_habitacional_acordos_conferidos on espelho_privado.habitacional_acordos_conferidos
  for select to authenticated using (
    (select espelho_privado.admin()) or
    espelho_privado.condominio_da_captacao('Habitacional', codigo_condominio) in (
      select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
    )
  );

create or replace function espelho_privado.aplicar_conferencia_habitacional(
  codigo text, captado_em timestamptz, dados jsonb
) returns jsonb language sql stable security invoker set search_path = '' as $func$
  with conferencias as (
    select unidade, numero, conferido_em, acordo, composicao
    from espelho_privado.habitacional_acordos_conferidos f
    where f.codigo_condominio = $1 and f.captacao_em <= $2
  ), base as (
    select acordo, ordem
    from jsonb_array_elements($3->'acordos') with ordinality as a(acordo,ordem)
  ), atualizados as (
    select b.acordo || case
      when f.composicao is not null then
        (case when $2 <= f.conferido_em then f.acordo else '{}'::jsonb end)
        || jsonb_build_object('composicaoFinanceira', f.composicao || jsonb_build_object('conferidoEm', f.conferido_em))
      when f.conferido_em is not null and $2 <= f.conferido_em then
        jsonb_build_object('situacaoHabitacionalPendente', true)
      else '{}'::jsonb end as acordo, b.ordem
    from base b
    left join conferencias f on f.unidade = b.acordo->>'unidade' and f.numero = b.acordo->>'numero'
    union all
    select f.acordo || jsonb_build_object('composicaoFinanceira', f.composicao || jsonb_build_object('conferidoEm', f.conferido_em)),
      null::bigint
    from conferencias f
    where f.acordo is not null and $2 <= f.conferido_em and not exists (
      select 1 from base b where f.unidade = b.acordo->>'unidade' and f.numero = b.acordo->>'numero'
    )
  )
  select case when exists(select 1 from conferencias)
    then jsonb_set($3,'{acordos}',coalesce((
      select jsonb_agg(a.acordo order by a.ordem nulls last, a.acordo->>'unidade', a.acordo->>'numero') from atualizados a
    ),'[]'::jsonb),false)
    else $3 end;
$func$;

revoke all on function espelho_privado.aplicar_conferencia_habitacional(text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function espelho_privado.aplicar_conferencia_habitacional(text,timestamptz,jsonb) to authenticated;

create or replace view public.captacoes_com_conferencias
  with (security_invoker = true) as
select c.id, c.codigo_condominio, c.condominio, c.administradora, c.administradora_chave, c.captado_em,
  case
    when c.administradora_chave = 'manager' and jsonb_typeof(c.dados->'acordos') = 'array'
      then espelho_privado.aplicar_conferencia_manager(c.codigo_condominio, c.captado_em, c.dados)
    when c.administradora_chave = 'habitacional' and jsonb_typeof(c.dados->'acordos') = 'array'
      then espelho_privado.aplicar_conferencia_habitacional(c.codigo_condominio, c.captado_em, c.dados)
    else c.dados
  end as dados
from public.captacoes_com_acordos c;

revoke all on public.captacoes_com_conferencias from public, anon, authenticated;
grant select on public.captacoes_com_conferencias to authenticated;
notify pgrst, 'reload schema';

commit;
