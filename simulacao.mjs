const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function localizarCadastro(captacao, registros) {
  const nome = normalizar(captacao.condominio)
  if (!nome) return null
  const candidatos = registros.filter(({ nome: cadastrado, cadastro }) =>
    [cadastrado, cadastro.nome_operacional].some(valor => normalizar(valor) === nome))
  if (candidatos.length === 1) return candidatos[0].cadastro
  const administradora = normalizar(captacao.administradora)
  const daAdministradora = candidatos.filter(registro => captacao.administradora_chave
    ? registro.administradora_chave === captacao.administradora_chave
    : [registro.administradora, registro.condominio_acessos?.administradora]
      .some(valor => normalizar(valor) === administradora))
  if (daAdministradora.length === 1) return daAdministradora[0].cadastro
  if (candidatos.length || !captacao.administradora_chave) return null
  const semPrefixo = nome => normalizar(nome).replace(/^condominio /, '')
  const alternativas = registros.filter(registro => registro.administradora_chave === captacao.administradora_chave
    && [registro.nome, registro.cadastro.nome_operacional].some(valor => semPrefixo(valor) === semPrefixo(nome)))
  return alternativas.length === 1 ? alternativas[0].cadastro : null
}

export function hojeEmSaoPaulo(instante = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instante)
  return ['year', 'month', 'day'].map(tipo => partes.find(parte => parte.type === tipo).value).join('-')
}

const dataUtc = data => new Date(data + 'T00:00:00Z')
const iso = data => data.toISOString().slice(0, 10)

export function somarDias(inicio, dias) {
  const data = dataUtc(inicio)
  data.setUTCDate(data.getUTCDate() + dias)
  return iso(data)
}

export function dataCivilValida(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
    && Number.isFinite(dataUtc(valor).getTime()) && iso(dataUtc(valor)) === valor
}

export function vencimentoMensal(inicio, meses, diaMensal) {
  if (meses === 0) return inicio
  const data = dataUtc(inicio)
  const dia = diaMensal ?? data.getUTCDate()
  data.setUTCDate(1)
  data.setUTCMonth(data.getUTCMonth() + meses)
  const ultimoDia = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)).getUTCDate()
  data.setUTCDate(Math.min(dia, ultimoDia))
  return iso(data)
}

const chaveRecibo = cota => JSON.stringify([cota.unidade, cota.recibo])
export function agruparCotas(dados, hoje, diasRegua) {
  const bloqueadas = new Set([
    ...(dados.cotasEmAcordoNoRelatorio ?? []),
    ...(dados.cotasConciliacaoPendente ?? []),
    ...dados.acordos.flatMap(acordo => [...(acordo.cotas ?? []), ...(acordo.cotasAbertasNoPeriodo ?? [])]
      .map(cota => ({ ...cota, unidade: acordo.unidade }))),
  ].map(chaveRecibo))
  const unidades = new Map()
  const limiteRegua = somarDias(hoje, -diasRegua)
  for (const cota of dados.cotas) {
    const valor = cota.valores?.at(-1)
    if (cota.acordoOrigem || bloqueadas.has(chaveRecibo(cota)) || !cota.unidade || !cota.recibo
      || !/^\d{4}-\d{2}-\d{2}$/.test(cota.vencimento ?? '') || !Number.isSafeInteger(valor) || valor <= 0) continue
    const cotas = unidades.get(cota.unidade) ?? new Map()
    cotas.set(chaveRecibo(cota), { ...cota, valor, regular: cota.vencimento > limiteRegua })
    unidades.set(cota.unidade, cotas)
  }
  return new Map([...unidades].sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map(([unidade, cotas]) => [unidade, [...cotas.values()].sort((a, b) => a.vencimento.localeCompare(b.vencimento))])
    .filter(([, cotas]) => cotas.some(cota => !cota.regular)))
}

export function calcularSimulacao({ cotas, percentual, quantidade, price, boleto, primeiroVencimento, diaMensal, isentarRegulares = false }) {
  const base = cotas.reduce((soma, cota) => soma + cota.valor, 0)
  const baseIsenta = isentarRegulares
    ? cotas.reduce((soma, cota) => soma + (cota.regular ? cota.valor : 0), 0)
    : 0
  const despesa = Math.round((base - baseIsenta) * percentual / 100)
  const comJuros = price && quantidade > 1
  let saldo = base + despesa
  const fator = 1.01 ** quantidade
  const prestacao = comJuros ? Math.round(saldo * 0.01 * fator / (fator - 1)) : Math.floor(saldo / quantidade)
  const parcelas = Array.from({ length: quantidade }, (_, indice) => {
    const juros = comJuros ? Math.round(saldo * 0.01) : 0
    const valor = indice === quantidade - 1 ? saldo + juros : Math.min(prestacao, saldo + juros)
    saldo -= valor - juros
    return { valor: valor + boleto, juros, vencimento: vencimentoMensal(primeiroVencimento, indice, diaMensal) }
  })
  return {
    base, baseIsenta, despesa, parcelas, boletos: boleto * quantidade,
    juros: parcelas.reduce((soma, parcela) => soma + parcela.juros, 0),
    total: parcelas.reduce((soma, parcela) => soma + parcela.valor, 0),
  }
}

export function lerValorMonetario(valor) {
  const texto = valor.trim()
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(texto)) return null
  const [reais, centavos = ''] = texto.replaceAll('.', '').split(',')
  const total = Number(reais) * 100 + Number(centavos.padEnd(2, '0'))
  return Number.isSafeInteger(total) && total > 0 ? total : null
}

export function validarParcelasEditadas(parcelas, total) {
  if (parcelas.some(p => !Number.isSafeInteger(p.valor) || p.valor <= 0)) {
    return 'Informe um valor positivo para cada parcela.'
  }
  if (parcelas.some((p, i) => !dataCivilValida(p.vencimento) ||
    (i > 0 && p.vencimento <= parcelas[i - 1].vencimento))) {
    return 'Informe vencimentos válidos em ordem crescente.'
  }
  if (parcelas.reduce((soma, p) => soma + p.valor, 0) !== total) {
    return 'A soma das parcelas precisa ser igual ao total da simulação.'
  }
  return ''
}
