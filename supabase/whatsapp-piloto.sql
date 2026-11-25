create table espelho_privado.whatsapp_piloto (
  id boolean primary key default true check (id),
  chave_hash text,
  estado text not null default 'aguardando_worker',
  qr text,
  atualizado_em timestamptz
);
insert into espelho_privado.whatsapp_piloto default values;
revoke all on espelho_privado.whatsapp_piloto from public, anon, authenticated;

create function public.whatsapp_piloto_publicar(chave text, estado text, qr text default null)
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
      atualizado_em = statement_timestamp();
end;
$$;
revoke all on function public.whatsapp_piloto_publicar(text,text,text) from public, authenticated;
grant execute on function public.whatsapp_piloto_publicar(text,text,text) to anon;

create function public.whatsapp_piloto_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not espelho_privado.admin() then raise insufficient_privilege; end if;
  return (select jsonb_build_object(
    'estado', case when p.atualizado_em > statement_timestamp() - interval '45 seconds'
      then p.estado else 'aguardando_worker' end,
    'qr', case when p.atualizado_em > statement_timestamp() - interval '22 seconds' then p.qr end
  ) from espelho_privado.whatsapp_piloto p);
end;
$$;
revoke all on function public.whatsapp_piloto_status() from public, anon;
grant execute on function public.whatsapp_piloto_status() to authenticated;
