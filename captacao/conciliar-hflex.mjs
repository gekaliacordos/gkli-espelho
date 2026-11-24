export function conciliarHflex(arquivos, anterior, captadoEm) {
  const historico = new Map((anterior?.acordos ?? []).map(acordo => [acordo.numero, acordo]))
  const acordos = arquivos.acordos.map(atual => {
    const antigo = historico.get(atual.numero)
    const mesmaComposicao = antigo && antigo.unidade === atual.unidade && antigo.dataPosicao === atual.dataPosicao
      && antigo.principal === atual.principal && antigo.total === atual.total
    const mesmoPagamento = mesmaComposicao && antigo.recebido === atual.recebido
    return {
      ...atual,
      cotas: mesmaComposicao ? antigo.cotas ?? null : null,
      parcelas: mesmoPagamento ? antigo.parcelas ?? null : null,
      situacao: mesmoPagamento ? antigo.situacao : null,
      detalhamentoConferidoEm: mesmaComposicao ? antigo.detalhamentoConferidoEm ?? anterior.acordosCaptadosEm : null,
    }
  })

  const porNumero = new Map(acordos.map(acordo => [acordo.numero, acordo]))
  const negociadas = new Set(acordos.flatMap(a => (a.cotas ?? []).map(cota => a.unidade + ":" + cota.recibo)))
  const vinculadas = []
  const pendentes = []
  for (const cota of arquivos.cotas) {
    if (!cota.acordoOrigem) {
      if (negociadas.has(cota.unidade + ':' + cota.recibo)) pendentes.push(cota)
      continue
    }
    const acordo = porNumero.get(cota.acordoOrigem)
    if (!acordo || acordo.unidade !== cota.unidade) {
      pendentes.push(cota)
      continue
    }
    const presenteNaComposicao = acordo.cotas?.some(item => item.recibo === cota.recibo && item.vencimento === cota.vencimento)
    if (presenteNaComposicao === false) {
      pendentes.push(cota)
      continue
    }
    vinculadas.push({
      ...cota,
      acordoSituacao: acordo.situacao,
      fonteVinculo: presenteNaComposicao ? 'XLS de devedores e composição detalhada' : 'Coluna ACORDO do XLS de devedores',
    })
  }

  return {
    unidades: arquivos.unidades, contatos: [], cotas: arquivos.cotas, acordos, acordosCaptadosEm: captadoEm,
    cotasEmAcordoNoRelatorio: vinculadas, cotasConciliacaoPendente: pendentes,
    fonteCotas: 'HFlex · Devedores Detalhado (XLS)', fonteAcordos: 'HFlex · Acordos Sintético (XLS)',
    conferenciaCotasAcordos: { ...arquivos.hashes, recibosEmAmbos: vinculadas.length, pendentes: pendentes.length },
    cobertura: `Empreendimento 0290. ${arquivos.cotas.length} recibos no relatório de devedores, ${vinculadas.length} vinculados a acordos e ${pendentes.length} pendentes de conferência. Quando disponível, o detalhamento anterior por recibo é mantido. Cadastro integral e responsáveis não conferidos.`,
  }
}
