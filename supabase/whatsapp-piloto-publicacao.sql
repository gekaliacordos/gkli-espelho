create or replace function public.whatsapp_piloto_publicar(chave text, estado text, qr text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(chave, '')) <> 64 or not exists (
    select 1 from espelho_privado.whatsapp_piloto p
    where p.chave_hash = encode(pg_catalog.sha256(convert_to(chave,'UTF8')), 'hex')
  ) then raise insufficient_privilege; end if;
  if estado is null or estado not in ('iniciando','aguardando_qr','autenticando','conectado','linha_divergente','desconectado')
      or (qr is not null and (estado <> 'aguardando_qr' or length(qr) > 120000
      or qr !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'))
  then raise invalid_parameter_value; end if;
  update espelho_privado.whatsapp_piloto p
  set estado = whatsapp_piloto_publicar.estado, qr = whatsapp_piloto_publicar.qr,
      atualizado_em = statement_timestamp() where p.id;
end;
$$;
