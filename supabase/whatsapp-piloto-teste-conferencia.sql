alter table espelho_privado.whatsapp_piloto_teste add column conferido_em timestamptz;
alter table espelho_privado.whatsapp_piloto_teste add column conferencia text
  check (conferencia in ('sem_recibo', 'consulta_indisponivel', 'multiplos_recibos', 'confirmado'));

create function public.whatsapp_piloto_conferir_teste(chave text, tarefa uuid default null,
  comprovante text default null, resultado text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(chave, '')) <> 64 or not exists (
    select 1 from espelho_privado.whatsapp_piloto p
    where p.chave_hash = encode(pg_catalog.sha256(convert_to(chave, 'UTF8')), 'hex')
  ) then raise insufficient_privilege; end if;
  if tarefa is null then
    return (select jsonb_build_object('id', t.id, 'numero', t.numero,
      'mensagem', t.mensagem, 'inicio', t.reservado_em, 'fim', t.concluido_em)
      from espelho_privado.whatsapp_piloto_teste t
      where t.estado = 'incerto' and t.conferido_em is null and t.expira_em > statement_timestamp()
      order by t.expira_em limit 1);
  end if;
  if resultado is null or resultado not in ('sem_recibo', 'consulta_indisponivel', 'multiplos_recibos', 'confirmado')
    or (resultado = 'confirmado' and (comprovante is null or comprovante !~ '^true_' or length(comprovante) > 256))
    or (resultado <> 'confirmado' and comprovante is not null)
  then raise invalid_parameter_value; end if;
  update espelho_privado.whatsapp_piloto_teste t
    set conferencia = resultado, conferido_em = statement_timestamp(),
        estado = case when resultado = 'confirmado' then 'enviado' else t.estado end,
        recibo = comprovante
    where t.id = tarefa and t.estado = 'incerto' and t.conferido_em is null;
  return to_jsonb(found);
end;
$$;
revoke all on function public.whatsapp_piloto_conferir_teste(text,uuid,text,text) from public, authenticated;
grant execute on function public.whatsapp_piloto_conferir_teste(text,uuid,text,text) to anon;
