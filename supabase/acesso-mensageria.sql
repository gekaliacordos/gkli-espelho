alter table public.espelho_usuarios drop constraint espelho_usuarios_modulos_check;
alter table public.espelho_usuarios add constraint espelho_usuarios_modulos_check
  check (modulos <@ array['cadastro', 'captacao', 'acordo', 'relatorios', 'mensageria']);

alter policy ler_condominios_gkli on public.condominios using (
  (select espelho_privado.admin()) or id in (
    select espelho_privado.condominios_permitidos(array['cadastro','acordo','relatorios','mensageria'])
  )
);
alter policy ler_captacoes_gkli on public.captacoes using (
  (select espelho_privado.admin()) or
  espelho_privado.condominio_da_captacao(administradora, codigo_condominio) in (
    select espelho_privado.condominios_permitidos(array['captacao','acordo','relatorios','mensageria'])
  )
);
alter policy ler_administradoras_gkli on public.administradoras using (
  (select espelho_privado.admin()) or chave in (
    select administradora_chave from public.condominios where id in (
      select espelho_privado.condominios_permitidos(array['cadastro','captacao','acordo','relatorios','mensageria'])
    )
  ) or chave in (select administradora_chave from public.captacoes)
);
