begin;

create table if not exists espelho_privado.manager_conferencias (
  codigo_condominio text not null check (codigo_condominio ~ '^manager-[0-9]+$'),
  captacao_em timestamptz not null,
  conferido_em timestamptz not null check (conferido_em >= captacao_em),
  fichas jsonb not null check (jsonb_typeof(fichas) = 'array'),
  primary key (codigo_condominio, conferido_em)
);

alter table espelho_privado.manager_conferencias enable row level security;
revoke all on espelho_privado.manager_conferencias from public, anon, authenticated;
grant select on espelho_privado.manager_conferencias to authenticated;
drop policy if exists ler_manager_conferencias on espelho_privado.manager_conferencias;
create policy ler_manager_conferencias on espelho_privado.manager_conferencias
  for select to authenticated using (
    (select espelho_privado.admin()) or
    espelho_privado.condominio_da_captacao('Manager', codigo_condominio) in (
      select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
    )
  );

create or replace function espelho_privado.aplicar_conferencia_manager(
  codigo text, captado_em timestamptz, dados jsonb
) returns jsonb language sql stable security invoker set search_path = '' as $func$
  with consulta as (
    select f.conferido_em, f.fichas
    from espelho_privado.manager_conferencias f
    where f.codigo_condominio = $1 and f.captacao_em <= $2
    order by f.conferido_em desc
    limit 1
  )
  select coalesce((
    select $3 || jsonb_build_object(
      'conferenciaManager', jsonb_build_object(
        'conferidoEm', f.conferido_em, 'aplicada', $2 <= f.conferido_em, 'fichas', f.fichas
      )
    ) || case when $2 <= f.conferido_em then jsonb_build_object('acordos', (
      with base as (
        select acordo, ordem
        from jsonb_array_elements($3->'acordos') with ordinality as a(acordo, ordem)
      ), conferidos as (
        select unidade, numero, acordo
        from jsonb_to_recordset(f.fichas) as r(unidade text, numero text, acordo jsonb)
        where acordo is not null
      ), atualizados as (
        select b.acordo || coalesce(c.acordo, '{}'::jsonb) as acordo, b.ordem
        from base b left join conferidos c
          on c.unidade = b.acordo->>'unidade' and c.numero = b.acordo->>'numero'
        union all
        select c.acordo, null::bigint
        from conferidos c
        where not exists (
          select 1 from base b where c.unidade = b.acordo->>'unidade' and c.numero = b.acordo->>'numero'
        )
      )
      select coalesce(jsonb_agg(a.acordo order by a.ordem nulls last, a.acordo->>'unidade', a.acordo->>'numero'), '[]'::jsonb)
      from atualizados a
    )) else '{}'::jsonb end
    from consulta f
  ), $3);
$func$;

revoke all on function espelho_privado.aplicar_conferencia_manager(text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function espelho_privado.aplicar_conferencia_manager(text,timestamptz,jsonb) to authenticated;

create or replace view public.captacoes_com_conferencias
  with (security_invoker = true) as
select c.id, c.codigo_condominio, c.condominio, c.administradora, c.administradora_chave, c.captado_em,
  case when c.administradora_chave = 'manager' and jsonb_typeof(c.dados->'acordos') = 'array'
    then espelho_privado.aplicar_conferencia_manager(c.codigo_condominio, c.captado_em, c.dados)
    else c.dados end as dados
from public.captacoes_com_acordos c;

revoke all on public.captacoes_com_conferencias from public, anon, authenticated;
grant select on public.captacoes_com_conferencias to authenticated;
notify pgrst, 'reload schema';

commit;
