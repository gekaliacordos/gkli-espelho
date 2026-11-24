import { hojeEmSaoPaulo } from './simulacao.mjs'

const ordemUnidade = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })
const dia = value => Date.parse(value + 'T00:00:00Z') / 86_400_000
const soma = (linhas, campo) => linhas.reduce((total, linha) => total + linha[campo], 0)
const chaveCota = ({ unidade, recibo }) => JSON.stringify([unidade, String(recibo)])
const chaveAcordo = ({ unidade, numero }) => JSON.stringify([unidade, String(numero)])
const centavos = valor => Number.isSafeInteger(valor) && valor >= 0
const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

export function lerReguaRanking(cadastro) {
  const inicio = cadastro?.dias_apos_vencimento_regua ?? cadastro?.inicio_cobranca_dias
  const duracao = cadastro?.dias_cobranca_ativa
  if ([inicio, duracao].some(valor => valor == null || String(valor).trim() === '' ||
    !Number.isSafeInteger(Number(valor)) || Number(valor) < 0) || Number(duracao) < 1) return null
  return { inicio: Number(inicio), fim: Number(inicio) + Number(duracao) }
}

function acordoEmAndamento(acordo) {
  const status = normalizar(acordo.situacao ?? acordo.status)
  if (/quitad|cancelad|encerrad|rompid|quebrad|liquidad|rescindid|renegociad|inativ|acordo pago/.test(status)) return false
  return (centavos(acordo.saldo) && acordo.saldo > 0)
    || (!centavos(acordo.saldo) && /ativ|andamento|vigent|abert|atras|pendente|efetivad|firmad/.test(status))
}

export function calcularRanking(captacao, regua) {
  const { dados } = captacao
  const posicao = hojeEmSaoPaulo(new Date(captacao.captado_em))
  const acordos = new Map()
  for (const acordo of dados.acordos ?? []) {
    if (!acordo.unidade || !acordo.numero || !acordoEmAndamento(acordo)) continue
    acordos.set(chaveAcordo(acordo), {
      ...acordo,
      saldo: centavos(acordo.saldo) ? acordo.saldo : null,
      judicial: acordo.judicial === true || normalizar(acordo.tipo ?? acordo.classificacao) === 'judicial',
      recibos: new Set(),
    })
  }

  const vinculos = new Map()
  function registrarVinculo(cota, chave) {
    if (!cota.recibo || !cota.unidade || !acordos.has(chave)) return
    const id = chaveCota(cota)
    if (!vinculos.has(id)) vinculos.set(id, new Set())
    vinculos.get(id).add(chave)
  }
  for (const [chave, acordo] of acordos) {
    for (const cota of acordo.cotas ?? []) registrarVinculo({ ...cota, unidade: acordo.unidade }, chave)
  }
  const vinculadasNaFonte = dados.cotasEmAcordoNoRelatorio ?? []
  for (const cota of vinculadasNaFonte) registrarVinculo(cota, chaveAcordo({ unidade: cota.unidade, numero: cota.acordoOrigem }))
  const pendencias = new Set((dados.cotasConciliacaoPendente ?? []).map(chaveCota))
  const cotas = new Map()
  const avisos = []
  let inconsistencias = 0
  for (const cota of [...(dados.cotas ?? []), ...vinculadasNaFonte]) {
    const saldo = cota.valores?.at(-1)
    if (!cota.unidade || !cota.recibo || !/^\d{4}-\d{2}-\d{2}$/.test(cota.vencimento ?? '') ||
      !Number.isFinite(dia(cota.vencimento)) || !centavos(saldo)) {
      inconsistencias++
      continue
    }
    const id = chaveCota(cota)
    const anterior = cotas.get(id)
    if (anterior && (anterior.saldo !== saldo || anterior.vencimento !== cota.vencimento)) {
      inconsistencias++
      continue
    }
    cotas.set(id, { ...anterior, ...cota, saldo })
    if (cota.acordoOrigem) registrarVinculo(cota, chaveAcordo({ unidade: cota.unidade, numero: cota.acordoOrigem }))
  }

  const faixas = [
    { nome: 'Administradora', criterio: 'Menos de ' + regua.inicio + ' dias desde o vencimento' },
    { nome: 'Janela de cobrança ativa', criterio: 'De ' + regua.inicio + ' a ' + (regua.fim - 1) + ' dias desde o vencimento' },
    { nome: 'Prazo de cobrança ativa atingido', criterio: regua.fim + ' dias ou mais desde o vencimento' },
  ]
  const grupos = faixas.map(() => new Map())
  const unidades = new Set()
  let excluidas = 0, saldoExcluido = 0, cotasPendentes = 0
  for (const [id, cota] of cotas) {
    if (!cota.saldo) continue
    const candidatos = vinculos.get(id)
    if (candidatos?.size === 1 && !pendencias.has(id)) {
      acordos.get([...candidatos][0]).recibos.add(id)
      excluidas++
      saldoExcluido += cota.saldo
      continue
    }
    if (pendencias.has(id) || candidatos?.size > 1 || cota.acordoOrigem || /^A/i.test(cota.marcacaoOrigem ?? '')) cotasPendentes++
    const atraso = dia(posicao) - dia(cota.vencimento)
    const faixa = grupos[atraso < regua.inicio ? 0 : atraso < regua.fim ? 1 : 2]
    const linha = faixa.get(cota.unidade) ?? { unidade: cota.unidade, quantidade: 0, saldo: 0, primeiro: cota.vencimento, ultimo: cota.vencimento }
    linha.quantidade++
    linha.saldo += cota.saldo
    if (cota.vencimento < linha.primeiro) linha.primeiro = cota.vencimento
    if (cota.vencimento > linha.ultimo) linha.ultimo = cota.vencimento
    faixa.set(cota.unidade, linha)
    unidades.add(cota.unidade)
  }
  const blocos = faixas.map((faixa, index) => {
    const linhas = [...grupos[index].values()].sort((a, b) => b.saldo - a.saldo || ordemUnidade(a.unidade, b.unidade))
    return { ...faixa, linhas, quantidade: soma(linhas, 'quantidade'), saldo: soma(linhas, 'saldo') }
  })
  const saldo = soma(blocos, 'saldo')
  if (cotasPendentes) avisos.push(cotasPendentes + ' cota(s) com vínculo de acordo pendente de conferência permanecem no ranking.')
  if (inconsistencias) avisos.push(inconsistencias + ' registro(s) inválido(s) ou divergente(s) exigem conferência na fonte.')
  if (centavos(dados.totalAbertas) && dados.totalAbertas !== saldo) avisos.push('O saldo calculado diverge do total de cotas abertas informado na captação.')
  const acordosOrdenados = [...acordos.values()].sort((a, b) => ordemUnidade(a.unidade, b.unidade) || ordemUnidade(String(a.numero), String(b.numero)))
  return {
    posicao, blocos, acordos: acordosOrdenados, avisos, saldo, unidades: unidades.size,
    quantidade: soma(blocos, 'quantidade'), excluidas, saldoExcluido, saldoFonte: dados.totalAbertas,
    saldoBruto: dados.totalInadimplencia, saldoAcordos: acordosOrdenados.reduce((total, a) => total + (a.saldo ?? 0), 0),
  }
}
