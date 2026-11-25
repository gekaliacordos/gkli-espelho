create table espelho_privado.whatsapp_piloto_teste (
  id uuid primary key default gen_random_uuid(),
  numero text not null check (numero ~ '^[0-9]{10,15}$'),
  mensagem text not null check (length(mensagem) between 1 and 280),
  expira_em timestamptz not null default (now() + interval '20 minutes'),
  estado text not null default 'pendente'
    check (estado in ('pendente', 'reservado', 'enviado', 'numero_nao_encontrado', 'incerto')),
  reservado_em timestamptz,
  concluido_em timestamptz,
  recibo text
);
revoke all on espelho_privado.whatsapp_piloto_teste from public, anon, authenticated;

create function public.whatsapp_piloto_reservar_teste(chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tarefa record;
begin
  if length(coalesce(chave, '')) <> 64 or not exists (
    select 1 from espelho_privado.whatsapp_piloto p
    where p.chave_hash = encode(pg_catalog.sha256(convert_to(chave, 'UTF8')), 'hex')
  ) then raise insufficient_privilege; end if;
  update espelho_privado.whatsapp_piloto_teste t
    set estado = 'reservado', reservado_em = statement_timestamp()
    where t.id = (
      select p.id from espelho_privado.whatsapp_piloto_teste p
      where p.estado = 'pendente' and p.expira_em > statement_timestamp()
      order by p.expira_em, p.id limit 1 for update skip locked
    )
    returning t.id, t.numero, t.mensagem into tarefa;
  if not found then return null; end if;
  return to_jsonb(tarefa);
end;
$$;

create function public.whatsapp_piloto_concluir_teste(chave text, tarefa uuid, resultado text, comprovante text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(chave, '')) <> 64 or not exists (
    select 1 from espelho_privado.whatsapp_piloto p
    where p.chave_hash = encode(pg_catalog.sha256(convert_to(chave, 'UTF8')), 'hex')
  ) then raise insufficient_privilege; end if;
  if resultado is null or resultado not in ('enviado', 'numero_nao_encontrado', 'incerto')
    or (resultado = 'enviado' and coalesce(length(comprovante), 0) not between 1 and 256)
    or (resultado <> 'enviado' and comprovante is not null)
  then raise invalid_parameter_value; end if;
  update espelho_privado.whatsapp_piloto_teste t
    set estado = resultado, recibo = comprovante, concluido_em = statement_timestamp()
    where t.id = tarefa and t.estado = 'reservado';
  return found;
end;
$$;
revoke all on function public.whatsapp_piloto_reservar_teste(text),
  public.whatsapp_piloto_concluir_teste(text,uuid,text,text) from public, authenticated;
grant execute on function public.whatsapp_piloto_reservar_teste(text),
  public.whatsapp_piloto_concluir_teste(text,uuid,text,text) to anon;
