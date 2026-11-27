begin;

create table if not exists espelho_privado.hflex_honorarios_acordos (
  codigo_condominio text not null check (codigo_condominio in ('hflex','hflex-5987')),
  unidade text not null,
  numero text not null,
  valor_centavos bigint not null check (valor_centavos >= 0),
  captacao_em timestamptz not null,
  conferido_em timestamptz not null,
  primary key (codigo_condominio,unidade,numero)
);
alter table espelho_privado.hflex_honorarios_acordos enable row level security;
revoke all on espelho_privado.hflex_honorarios_acordos from public, anon, authenticated;
grant select on espelho_privado.hflex_honorarios_acordos to authenticated;
drop policy if exists ler_honorarios_hflex on espelho_privado.hflex_honorarios_acordos;
create policy ler_honorarios_hflex on espelho_privado.hflex_honorarios_acordos for select to authenticated using (
  (select espelho_privado.admin()) or espelho_privado.condominio_da_captacao('HFlex',codigo_condominio) in (
    select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
  )
);

create or replace view public.captacoes_com_acordos
  with (security_invoker = true) as
select c.id, c.codigo_condominio, c.condominio, c.administradora, c.administradora_chave, c.captado_em,
  case
    when c.administradora_chave = 'hflex'
      and jsonb_typeof(c.dados->'acordos') = 'array'
      and exists (select 1 from espelho_privado.hflex_honorarios_acordos h where h.codigo_condominio = c.codigo_condominio)
    then jsonb_set(c.dados,'{acordos}',(
      select coalesce(jsonb_agg(
        case when h.numero is null then item.acordo else item.acordo ||
          jsonb_build_object('honorariosCobranca',h.valor_centavos,'honorariosHflexConferidosEm',h.conferido_em)
        end order by item.ordem
      ),'[]'::jsonb)
      from jsonb_array_elements(c.dados->'acordos') with ordinality as item(acordo,ordem)
      left join espelho_privado.hflex_honorarios_acordos h
        on h.codigo_condominio=c.codigo_condominio and h.numero=item.acordo->>'numero'
        and h.unidade=item.acordo->>'unidade' and c.captado_em>=h.captacao_em
    ), false)
    when c.administradora_chave = 'bbz'
      and exists (select 1 from espelho_privado.bbz_acordos_confirmados f where f.codigo_condominio = c.codigo_condominio)
      and jsonb_typeof(c.dados->'acordos') = 'array' then
      jsonb_set(c.dados, '{acordos}', (
        select coalesce(jsonb_agg(
          case when f.numero is null then item.acordo else
            item.acordo
            || case when f.quitacao is not null and (
              c.captado_em <= f.conferido_em
              or (item.acordo->'saldo' = '0'::jsonb
                and item.acordo->'total' = item.acordo->'recebido')
            ) then f.quitacao || jsonb_build_object('situacaoAntesDaConferencia', item.acordo->>'situacao')
            else '{}'::jsonb end
            || case when jsonb_typeof(item.acordo->'parcelas') = 'array' and f.recibos <> '[]'::jsonb then
              jsonb_build_object('parcelas', (
                select coalesce(jsonb_agg(p.parcela || case when b.recibo is null then '{}'::jsonb
                  else jsonb_build_object('recibo', b.recibo) end order by p.ordem), '[]'::jsonb)
                from jsonb_array_elements(item.acordo->'parcelas') with ordinality as p(parcela,ordem)
                left join jsonb_to_recordset(f.recibos) as b(parcela text, vencimento text, valor bigint, recibo text)
                  on b.parcela = p.parcela->>'numero' and b.vencimento = p.parcela->>'vencimento'
                  and to_jsonb(b.valor) = p.parcela->'valor'
              ))
            else '{}'::jsonb end
          end order by item.ordem
        ), '[]'::jsonb)
        from jsonb_array_elements(c.dados->'acordos') with ordinality as item(acordo, ordem)
        left join espelho_privado.bbz_acordos_confirmados f
          on f.codigo_condominio = c.codigo_condominio and f.unidade = item.acordo->>'unidade' and f.numero = item.acordo->>'numero'
          and c.captado_em >= f.captacao_em
      ), false)
    when c.administradora_chave = 'lello' and jsonb_typeof(c.dados->'acordos') = 'array' then
      jsonb_set(c.dados, '{acordos}', (
        select coalesce(jsonb_agg(
          case when f.numero is null then item.acordo else
            item.acordo ||
            jsonb_build_object('composicaoFinanceira', f.composicao || jsonb_build_object(
              'fonte', 'Lello Acob', 'situacaoAcob', f.situacao, 'conferidoEm', f.conferido_em
            )) ||
            case when f.situacao in ('CANCELADO', 'QUITADO')
              and (c.captado_em <= f.conferido_em or
                lower(coalesce(item.acordo->>'situacao', item.acordo->>'status', ''))
                  !~ 'quitad|cancelad|encerrad|rompid|quebrad|liquidad|rescindid|renegociad|inativ|acordo pago')
              then jsonb_build_object(
                'situacao', initcap(f.situacao),
                'situacaoNaCaptacao', coalesce(item.acordo->>'situacao', item.acordo->>'status')
              )
              else '{}'::jsonb
            end
          end
          order by item.ordem
        ), '[]'::jsonb)
        from jsonb_array_elements(c.dados->'acordos') with ordinality as item(acordo, ordem)
        left join espelho_privado.lello_acordos_financeiros f
          on f.codigo_condominio = c.codigo_condominio
          and f.unidade = item.acordo->>'unidade'
          and f.numero = item.acordo->>'numero'
          and c.captado_em >= f.captacao_em
      ), false)
    else c.dados
  end as dados
from public.captacoes c;

revoke all on public.captacoes_com_acordos from public, anon, authenticated;
grant select on public.captacoes_com_acordos to authenticated;
notify pgrst, 'reload schema';

commit;
