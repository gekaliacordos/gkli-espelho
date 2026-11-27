begin;

create table if not exists espelho_privado.lello_acordos_financeiros (
  codigo_condominio text not null check (codigo_condominio ~ '^[0-9]+$'),
  unidade text not null check (unidade <> ''),
  numero text not null check (numero ~ '^[0-9]+$'),
  situacao text not null check (situacao in ('EM ANDAMENTO', 'ATRASADO', 'CANCELADO', 'QUITADO')),
  composicao jsonb not null check (jsonb_typeof(composicao) = 'object'),
  captacao_em timestamptz not null,
  conferido_em timestamptz not null check (conferido_em >= captacao_em),
  primary key (codigo_condominio, unidade, numero)
);

alter table espelho_privado.lello_acordos_financeiros enable row level security;
revoke all on espelho_privado.lello_acordos_financeiros from public, anon, authenticated;
grant select on espelho_privado.lello_acordos_financeiros to authenticated;

drop policy if exists ler_composicao_lello on espelho_privado.lello_acordos_financeiros;
create policy ler_composicao_lello on espelho_privado.lello_acordos_financeiros
  for select to authenticated using (
    (select espelho_privado.admin()) or
    espelho_privado.condominio_da_captacao('Lello', codigo_condominio) in (
      select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
    )
  );

create or replace view public.captacoes_com_acordos
  with (security_invoker = true) as
select c.id, c.codigo_condominio, c.condominio, c.administradora, c.administradora_chave, c.captado_em,
  case
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
