create table espelho_privado.whatsapp_piloto_linhas (
  linha text primary key,
  nome text not null,
  numero text not null check (numero ~ '^[0-9]{10,15}$'),
  chave_hash text check (chave_hash ~ '^[a-f0-9]{64}$'),
  estado text not null default 'aguardando_worker',
  qr text,
  atualizado_em timestamptz
);
revoke all on espelho_privado.whatsapp_piloto_linhas from public, anon, authenticated;
insert into espelho_privado.whatsapp_piloto_linhas (linha, nome, numero) values
  ('genske','Genske Advogados','551135027774'),
  ('escritorio','Escritório Genske Adv','551135027775'),
  ('azevedo','Azevedo Araújo','5511921486828'),
  ('riseup','Rise Up','5511973641030');

create function public.whatsapp_piloto_publicar_linha(linha text, chave text, numero text, estado text, qr text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if estado is null or estado not in ('iniciando','aguardando_qr','autenticando','conectado','linha_divergente','desconectado')
      or (qr is not null and (estado <> 'aguardando_qr' or length(qr) > 120000
      or qr !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'))
  then raise invalid_parameter_value; end if;
  if length(coalesce(chave, '')) <> 64 then raise insufficient_privilege; end if;
  update espelho_privado.whatsapp_piloto_linhas p
    set estado = whatsapp_piloto_publicar_linha.estado, qr = whatsapp_piloto_publicar_linha.qr,
        atualizado_em = statement_timestamp()
    where p.linha = whatsapp_piloto_publicar_linha.linha and p.numero = whatsapp_piloto_publicar_linha.numero
      and p.chave_hash = encode(pg_catalog.sha256(convert_to(chave, 'UTF8')), 'hex');
  if not found then raise insufficient_privilege; end if;
end;
$$;

create function public.whatsapp_piloto_status_linhas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not espelho_privado.admin() then raise insufficient_privilege; end if;
  return (
    select jsonb_agg(jsonb_build_object('linha', l.linha, 'nome', l.nome, 'final', l.final,
      'estado', case when l.atualizado_em > statement_timestamp() - interval '45 seconds'
        then l.estado else 'aguardando_worker' end,
      'qr', case when l.atualizado_em > statement_timestamp() - interval '22 seconds' then l.qr end
    ) order by (l.linha <> 'gekali'), l.nome)
    from (
      select 'gekali' linha, 'GEKALI' nome, '0545' final, p.estado, p.qr, p.atualizado_em
      from espelho_privado.whatsapp_piloto p
      union all
      select p.linha, p.nome, right(p.numero,4), p.estado, p.qr, p.atualizado_em
      from espelho_privado.whatsapp_piloto_linhas p
    ) l
  );
end;
$$;

revoke all on function public.whatsapp_piloto_publicar_linha(text,text,text,text,text) from public, authenticated;
grant execute on function public.whatsapp_piloto_publicar_linha(text,text,text,text,text) to anon;
revoke all on function public.whatsapp_piloto_status_linhas() from public, anon;
grant execute on function public.whatsapp_piloto_status_linhas() to authenticated;

-- O destinatário confirmou que recebeu o primeiro teste. A confirmação
-- manual fica registrada à parte, preservando o diagnóstico sem recibo.
alter table espelho_privado.whatsapp_piloto_teste add column recebimento_confirmado_em timestamptz;
