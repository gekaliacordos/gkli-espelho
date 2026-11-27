alter table espelho_privado.atipass_conferencias rename to webware_acordos_conferidos;

alter table espelho_privado.webware_acordos_conferidos
  drop constraint atipass_conferencias_codigo_condominio_check,
  add constraint webware_acordos_conferidos_codigo_condominio_check
    check (codigo_condominio in ('atipass', 'villagua'));

drop policy ler_atipass_conferencias on espelho_privado.webware_acordos_conferidos;

alter function espelho_privado.aplicar_conferencia_atipass(text, timestamptz, jsonb)
  rename to aplicar_conferencia_webware;

create policy ler_webware_acordos_conferidos on espelho_privado.webware_acordos_conferidos
  for select to authenticated using (
    (select espelho_privado.admin()) or
    espelho_privado.condominio_da_captacao(
      case codigo_condominio when 'atipass' then 'Atipass' when 'villagua' then 'Villágua' end,
      codigo_condominio
    ) in (
      select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
    )
  );

create or replace function espelho_privado.aplicar_conferencia_webware(
  codigo text, captado_em timestamptz, dados jsonb
) returns jsonb language sql stable security invoker set search_path = '' as $func$
  with conferencia as (
    select f.conferido_em, f.acordos, f.ausentes,
      coalesce(nullif($3->>'acordosCaptadosEm', '')::timestamptz, $2) <= f.conferido_em as aplicada
    from espelho_privado.webware_acordos_conferidos f
    where f.codigo_condominio = $1 and f.captacao_em <= $2
    order by f.conferido_em desc
    limit 1
  ), base as (
    select acordo
    from jsonb_array_elements($3->'acordos') as item(acordo)
  )
  select coalesce((
    select $3 || jsonb_build_object(
      case $1 when 'atipass' then 'conferenciaAtipass' else 'conferenciaVillagua' end,
      jsonb_build_object('conferidoEm', f.conferido_em, 'aplicada', f.aplicada, 'ausentes', f.ausentes)
    ) || case when f.aplicada then jsonb_build_object(
      'acordos', (
        select coalesce(jsonb_agg(
          case when b.acordo->'periodoNegociado' = item.acordo->'periodoNegociado'
            then b.acordo || (item.acordo - 'cotas') else item.acordo end
          order by item.ordem
        ), '[]'::jsonb)
        from jsonb_array_elements(f.acordos) with ordinality as item(acordo, ordem)
        left join base b on b.acordo->>'unidade' = item.acordo->>'unidade'
          and b.acordo->>'numero' = item.acordo->>'numero'
      ), 'acordosCaptadosEm', f.conferido_em
    ) else '{}'::jsonb end
    from conferencia f
  ), $3);
$func$;

revoke all on function espelho_privado.aplicar_conferencia_webware(text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function espelho_privado.aplicar_conferencia_webware(text,timestamptz,jsonb) to authenticated;

create or replace view public.captacoes_com_conferencias
  with (security_invoker = true) as
select c.id, c.codigo_condominio, c.condominio, c.administradora, c.administradora_chave, c.captado_em,
  case
    when c.administradora_chave = 'manager' and jsonb_typeof(c.dados->'acordos') = 'array'
      then espelho_privado.aplicar_conferencia_manager(c.codigo_condominio, c.captado_em, c.dados)
    when c.administradora_chave = 'habitacional' and jsonb_typeof(c.dados->'acordos') = 'array'
      then espelho_privado.aplicar_conferencia_habitacional(c.codigo_condominio, c.captado_em, c.dados)
    when c.administradora_chave in ('atipass', 'villagua') and jsonb_typeof(c.dados->'acordos') = 'array'
      then espelho_privado.aplicar_conferencia_webware(c.codigo_condominio, c.captado_em, c.dados)
    else c.dados
  end as dados
from public.captacoes_com_acordos c;

revoke all on public.captacoes_com_conferencias from public, anon, authenticated;
grant select on public.captacoes_com_conferencias to authenticated;
notify pgrst, 'reload schema';
