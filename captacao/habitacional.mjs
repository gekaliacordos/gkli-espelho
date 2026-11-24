import { chromium } from 'playwright'
import parsePdf from 'pdf-parse/lib/pdf-parse.js'
import { centavos } from './condopro.mjs'

const origem = 'https://apps.habita.com.br'
export const alvosHabitacional = [
  ['3118', 'MAIS ESTILO & DESIGN MORUMBI', 'Residencial Mais Estilo & Design Morumbi'],
  ['3145', 'METROCASA MORUMBI', 'Residencial Metrocasa Morumbi'],
  ['3132', 'IL FARO', 'Il Faro'],
]
const moeda = /(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}/g
const valores = texto => [...texto.matchAll(moeda)].map(m => centavos(m[0]))
const unidade = (bloco, numero) => bloco === '0' ? numero : bloco + ' / ' + numero
const chave = cota => cota.unidade + ':' + cota.recibo
const data = texto => '20' + texto.slice(6) + '-' + texto.slice(3, 5) + '-' + texto.slice(0, 2)

function conferirIdentidade(texto, [codigo, nome]) {
  const ids = [...texto.matchAll(/(?:^|Condomínio:\s*)(\d{4}) - (.*?)CNPJ:/gm)]
  if (!ids.length || ids.some(m => m[1] !== codigo || m[2] !== nome)) throw Error('Identidade do PDF divergente.')
}

function lerCotas(texto, alvo) {
  conferirIdentidade(texto, alvo)
  const recibos = []
  let atual, id
  for (const linha of texto.split('\n')) {
    const un = linha.match(/^Bloco:\s*(\S+).*?Unidade:\s*(\S+)/i)
    const boleto = linha.match(/^(\d{8})([\d.]+,\d{2})(\d{2}\/\d{2}\/\d{2})(.*)$/)
    if ((un || boleto || /Total da Unidade:|Total Geral:/.test(linha)) && atual) {
      recibos.push(atual)
      atual = null
    }
    if (un) id = unidade(un[1], un[2])
    if (boleto) {
      const m = [...boleto[4].matchAll(moeda)]
      if (!id || m.length < 4) throw Error('Colunas de inadimplência incompletas.')
      const marca = boleto[4].slice(m[3].index + m[3][0].length).match(/^(AE|AJ|A|J|P)/)?.[1]
      atual = {
        unidade: id, recibo: boleto[1], vencimento: data(boleto[3]), marcacaoOrigem: marca,
        garantidora: /cedido GARANTIDORA/i.test(linha), subtotal: false,
        valores: [m[3][0], m[2][0], m[1][0], m[0][0], boleto[2]].map(centavos),
      }
    } else if (/Total do boleto:/i.test(linha)) {
      if (!atual) throw Error('Subtotal sem recibo.')
      recibos.push({ ...atual, subtotal: true, valores: valores(linha) })
      atual = null
    }
  }
  if (atual) throw Error('Recibo sem fechamento.')
  const idRecibo = cota => chave(cota) + ':' + cota.vencimento
  const subtotais = new Set(recibos.filter(c => c.subtotal).map(idRecibo))
  const limpos = recibos.filter(c => c.subtotal || !subtotais.has(idRecibo(c)))
  const unidades = [...new Set(limpos.map(c => c.unidade))]
  const total = texto.match(/Quantidade de Unidades inadimplentes do Condomínio:\s*(\d+)Total Geral:(.+)/)
  const esperado = valores(total?.[2] ?? '')
  const soma = limpos.reduce((s, c) => s.map((v, i) => v + c.valores[i]), [0, 0, 0, 0, 0])
  if (unidades.length !== Number(total?.[1]) || new Set(limpos.map(idRecibo)).size !== limpos.length
      || esperado.length !== 5 || limpos.some(c => c.valores.length !== 5)
      || esperado.some((v, i) => v !== soma[i])) throw Error('Totais da inadimplência divergentes.')
  return { unidades, contatos: [], cotas: limpos.map(({ subtotal, ...cota }) => cota) }
}

function lerAcordos(texto, alvo) {
  conferirIdentidade(texto, alvo)
  const acordos = new Map()
  let id, atual, composicao
  for (const linha of texto.split('\n').map(s => s.trim())) {
    const un = linha.match(/^Bloco:\s*(\S+).*?Unidade:\s*(\S+)/i)
    if (un) id = unidade(un[1], un[2])
    const proc = linha.match(/^Processo:\s*(\d+)\s*•\s*Gerado em:\s*(\d{2}\/\d{2}\/\d{2})\s*•\s*Tipo:\s*([A-Z]+)\s*-\s*(.*?)Período de:\s*(\d{2}\/\d{2}\/\d{2})\s+até\s+(\d{2}\/\d{2}\/\d{2})/i)
    if (proc) {
      atual = acordos.get(proc[1]) ?? {
        numero: proc[1], unidade: id, dataPosicao: data(proc[2]), tipoOrigem: proc[3] + ' - ' + proc[4].trim(),
        situacao: 'Em andamento', periodoNegociado: { inicio: data(proc[5]), fim: data(proc[6]) }, cotas: [],
      }
      if (!id || atual.unidade !== id) throw Error('Unidade do acordo divergente.')
      acordos.set(proc[1], atual)
      continue
    }
    if (/^BoletoTotalJuros/i.test(linha)) composicao = true
    if (/^Parcelamento|^Total geral do processo:/i.test(linha)) composicao = false
    const total = linha.match(/^Total geral do processo:([\d.,]+)$/i)
    if (total) {
      if (!atual || atual.total !== undefined) throw Error('Subtotal de acordo inválido.')
      atual.total = centavos(total[1])
    }
    const boleto = linha.match(/^(\d{8})(?=\d)/)
    if (composicao && boleto && atual && !atual.cotas.some(c => c.recibo === boleto[1])) atual.cotas.push({ recibo: boleto[1] })
  }
  if (acordos.size !== (texto.match(/Total geral do processo:/g) ?? []).length
      || [...acordos.values()].some(a => !Number.isInteger(a.total) || !a.cotas.length)) throw Error('Grade de acordos incompleta.')
  if (!acordos.size && !/nenhum acordo|não (?:há|existem) acordos/i.test(texto)) throw Error('Ausência de acordos não confirmada.')
  return [...acordos.values()]
}

function conciliar(cotas, acordos) {
  const indice = new Map()
  for (const acordo of acordos) {
    for (const recibo of acordo.cotas) {
      const k = chave({ unidade: acordo.unidade, ...recibo })
      indice.set(k, [...(indice.get(k) ?? []), acordo.numero])
    }
  }
  const abertas = [], vinculadas = [], pendentes = [], garantidora = []
  for (const cota of cotas.cotas) {
    const nomes = indice.get(chave(cota)) ?? []
    if (nomes.length === 1) vinculadas.push({ ...cota, acordoOrigem: nomes[0], fonteVinculo: 'Unidade e recibo na composição do acordo' })
    else if (nomes.length > 1 || cota.marcacaoOrigem?.startsWith('A')) pendentes.push(cota)
    else if (cota.garantidora && cota.valores.at(-1) === 1) garantidora.push(cota)
    else abertas.push(cota)
  }
  return { ...cotas, cotas: abertas, cotasEmAcordoNoRelatorio: vinculadas, cotasConciliacaoPendente: pendentes, referenciasGarantidora: garantidora,
    totalInadimplencia: cotas.cotas.reduce((s, c) => s + c.valores.at(-1), 0) }
}

const tokenHabita = texto => texto.match(/paravoce@habita\.com\.br[\s\S]{0,1200}?concluir o login:\s*(\d{4,8})/i)?.[1]

export async function coletarHabitacional(credenciais, visitar) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const caixa = await browser.newPage(), pagina = await browser.newPage()
  let etapa = 'abertura do Outlook'
  try {
    await caixa.goto('https://outlook.office.com/mail/', { waitUntil: 'domcontentloaded' })
    const microsoft = () => new URL(caixa.url()).origin === 'https://login.microsoftonline.com'
    if (!microsoft()) await caixa.waitForURL(u => u.origin === 'https://login.microsoftonline.com', { timeout: 25_000 })
    etapa = 'login do Outlook'
    if (!microsoft()) throw Error('Origem do login da caixa divergente.')
    await caixa.locator('input[type=email]').fill(credenciais.usuario)
    await caixa.getByRole('button', { name: /Next|Avançar/i }).click()
    const senha = caixa.locator('input[type=password]')
    await senha.waitFor()
    if (!microsoft()) throw Error('Origem da senha da caixa divergente.')
    await senha.fill(credenciais.senha)
    await caixa.getByRole('button', { name: /Sign in|Entrar/i }).click()
    const nao = caixa.getByRole('button', { name: /^(Não|No)$/ })
    await Promise.race([
      nao.waitFor({ timeout: 15_000 }),
      caixa.waitForURL(u => u.origin === 'https://outlook.office.com', { timeout: 15_000 }),
    ]).catch(() => {})
    if (await nao.isVisible()) await nao.click()
    etapa = 'caixa de entrada'
    await caixa.getByText(/Habita Para Você.*Envio de Token/).first().waitFor({ timeout: 45_000 })
    const anterior = tokenHabita(await caixa.locator('body').innerText())
    etapa = 'solicitação do código'
    await pagina.goto(origem + '/parceiro/Login', { waitUntil: 'domcontentloaded' })
    if (new URL(pagina.url()).origin !== origem) throw Error('Origem do portal Habitacional divergente.')
    const avancar = pagina.getByRole('button', { name: 'Avançar', exact: true }).filter({ visible: true }).first()
    await pagina.locator('#email').fill(credenciais.usuario)
    await avancar.click()
    await pagina.locator('#token').waitFor()
    etapa = 'recebimento do código'
    let token
    for (let i = 0; i < 60; i++) {
      token = tokenHabita(await caixa.locator('body').innerText())
      if (token && token !== anterior) break
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    if (!token || token === anterior || new URL(pagina.url()).origin !== origem) throw Error('Token novo da Habitacional não confirmado.')
    etapa = 'autenticação no portal'
    await pagina.locator('#token').fill(token)
    await avancar.click()
    await pagina.waitForURL(u => u.origin === origem && u.pathname.endsWith('/CondominioLista'))
    etapa = 'relatórios por condomínio'
    for (const alvo of alvosHabitacional) {
      await visitar('habitacional-' + alvo[0], alvo[2], async etapa => {
        if (!pagina.url().endsWith('/CondominioLista')) await pagina.goto(origem + '/parceiro/Home/CondominioLista', { waitUntil: 'domcontentloaded' })
        await pagina.getByText(alvo[1] + ' - Advogado', { exact: false }).click()
        await avancar.click()
        await pagina.getByText(alvo[1], { exact: true }).first().waitFor()
        const relatorio = async rota => {
          await pagina.goto(origem + '/parceiro/' + rota + '/index', { waitUntil: 'domcontentloaded' })
          await pagina.getByText('Todas as unidades', { exact: true }).click()
          const recebimento = pagina.context().waitForEvent('response', {
            predicate: r => new URL(r.url()).origin === origem && /application\/pdf/i.test(r.headers()['content-type'] ?? ''),
            timeout: 120_000,
          })
          recebimento.catch(() => {})
          await pagina.getByText('Processar', { exact: true }).click()
          const bytes = await (await recebimento).body()
          if (bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('Exportação não é PDF.')
          return (await parsePdf(bytes)).text
        }
        const cotas = await etapa('cotas', async () => lerCotas(await relatorio('InadimplenciaAtualizada'), alvo))
        const acordos = await etapa('acordos', async () => lerAcordos(await relatorio('AcordosAndamento'), alvo))
        // A conciliação depende das duas fontes da mesma coleta.
        return cotas && acordos ? { cotas: conciliar(cotas, acordos), acordos } : { acordos }
      })
    }
  } catch (erro) {
    console.error('Habitacional:', etapa, erro.name === 'TimeoutError' ? 'tempo esgotado' : 'falhou')
    throw erro
  } finally {
    await browser.close()
  }
}
