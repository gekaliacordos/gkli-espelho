async function transacaoPorCondominio(banco, portal, executar) {
  await banco.query('begin')
  try {
    await banco.query('select pg_advisory_xact_lock(hashtext($1))', [portal])
    const resultado = await executar()
    await banco.query('commit')
    return resultado
  } catch (erro) {
    await banco.query('rollback').catch(() => {})
    throw erro
  }
}

export async function gravarCotasWebware(banco, portal, config, dados) {
  return transacaoPorCondominio(banco, portal, async () => {
    const { rows: [captacao] } = await banco.query(`select dados->'acordos' as acordos,
        dados->>'acordosCaptadosEm' as "acordosCaptadosEm"
      from public.captacoes where codigo_condominio = $1 and dados ? 'acordosCaptadosEm'
      order by (dados->>'acordosCaptadosEm')::timestamptz desc limit 1`, [portal])
    await banco.query(`insert into public.captacoes (codigo_condominio, condominio, administradora, captado_em, dados)
      values ($1, $2, $3, $4, $5)`, [portal, config.nome, config.adm, new Date(), comAcordos(dados, captacao)])
  })
}

function comAcordos(dados, captacao) {
  if (!captacao) return dados
  return {
    ...dados,
    ...captacao,
    cobertura: (dados.unidadesDoFiltro ? 'Unidades do filtro do portal. ' : 'Unidades do relatório de cotas. ')
      + 'Cotas em aberto e grade de acordos conferidas. Responsáveis e composição das cotas negociadas ainda não foram conferidos.',
  }
}

export async function gravarAcordosWebware(banco, portal, acordos, captadoEm) {
  return transacaoPorCondominio(banco, portal, async () => {
    const { rows: [captacao] } = await banco.query(`select id, dados from public.captacoes
      where codigo_condominio = $1 order by captado_em desc limit 1`, [portal])
    if (!captacao) throw new Error('Captação de cotas ausente para este condomínio.')
    if (Date.parse(captacao.dados.acordosCaptadosEm) > Date.parse(captadoEm)) {
      throw new Error('Já existe uma grade de acordos mais recente.')
    }
    const dados = comAcordos(captacao.dados, { acordos, acordosCaptadosEm: captadoEm })
    const { rows: [salvo] } = await banco.query(`update public.captacoes set dados = $2
      where id = $1 returning jsonb_array_length(dados->'acordos') as quantidade`, [captacao.id, dados])
    if (salvo?.quantidade !== acordos.length) throw new Error('Quantidade de acordos gravados diverge da grade.')
    return salvo.quantidade
  })
}
