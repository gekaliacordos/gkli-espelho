import { createHash } from 'node:crypto'
import { centavos, dataIso } from './condopro.mjs'
import { comSessaoWebware } from './webware.mjs'

const cabecalho = 'Bloco|Unidade|Processo|Período|Valor Principal|Parcela|Vencimento|Valor da parcela|Data recebimento|Valor recebido|Saldo|% Quitado'
const tituloGrade = /Acompanhamento de Acordo: Aberto e Baixado/i
const textoVazio = 'Não há acordos registrados.'

function valorOpcional(valor) {
  return valor ? centavos(valor) : null
}

export function lerAcordosWebware(paginas, { incluirDetalhes = false } = {}) {
  const acordos = new Map()
  const hashes = new Set()
  for (const { linhas } of paginas) {
    const hash = createHash('sha256').update(JSON.stringify(linhas)).digest('hex')
    if (hashes.has(hash) || linhas[0]?.join('|') !== cabecalho) {
      throw new Error('Página de acordos repetida ou cabeçalho divergente.')
    }
    hashes.add(hash)
    const acordosPagina = []
    let atual, totalGeral = false
    for (const linha of linhas.slice(1)) {
      if (totalGeral) throw new Error('Há linhas após o total geral da grade.')
      if (linha[0] === '(=) Total Geral') {
        const somar = campo => acordosPagina.reduce((soma, acordo) => soma + (acordo[campo] ?? 0), 0)
        if (centavos(linha[1]) !== somar('total') || (valorOpcional(linha[3]) ?? 0) !== somar('recebido')
          || (valorOpcional(linha[4]) ?? 0) !== somar('saldo')) throw new Error('Totais da página divergem do portal.')
        totalGeral = true
      } else if (linha[0] === '(=) Total') {
        if (!atual) throw new Error('Subtotal de acordo sem processo.')
        atual.total = centavos(linha[1])
        atual.recebido = valorOpcional(linha[3])
        atual.saldo = valorOpcional(linha[4])
        if (incluirDetalhes) atual.percentualQuitadoPortal = linha[5] || null
        atual.situacao = atual.saldo === null ? 'Saldo não informado'
          : atual.saldo > 0 ? 'Com saldo em aberto' : atual.saldo === 0 ? 'Saldo zerado' : 'Saldo credor'
        if (atual.parcelas.reduce((soma, parcela) => soma + parcela.valor, 0) !== atual.total
          || atual.parcelas.reduce((soma, parcela) => soma + (parcela.recebido ?? 0), 0) !== (atual.recebido ?? 0)
          || (atual.saldo !== null && atual.saldo !== atual.total - (atual.recebido ?? 0))) {
          throw new Error('Valor do acordo diverge da soma das parcelas.')
        }
        const chave = atual.unidade + ':' + atual.numero
        if (acordos.has(chave)) throw new Error('Acordo repetido na grade.')
        acordos.set(chave, atual)
        acordosPagina.push(atual)
        atual = undefined
      } else {
        let campos
        if (linha.length === 12 && /^\d+$/.test(linha[2])) {
          if (atual || !linha[0] || !linha[1]) throw new Error('Processo sem identidade ou subtotal.')
          const periodo = linha[3].split(/\s+a\s+/i)
          if (periodo.length !== 2) throw new Error('Período negociado ausente ou inválido.')
          const [inicio, fim] = periodo.map(dataIso)
          if (inicio > fim) throw new Error('Período negociado invertido.')
          atual = { unidade: linha[0] + '/' + linha[1], numero: linha[2], parcelas: [], cotas: null,
            periodoNegociado: { inicio, fim } }
          if (incluirDetalhes) atual.principal = valorOpcional(linha[4])
          campos = linha.slice(5, 10)
        } else if (atual && linha.length === 8 && !linha[0]) {
          campos = linha.slice(1, 6)
        } else {
          throw new Error('Linha desconhecida na grade de acordos.')
        }
        const [parcela, vencimento, valor, pagamento, recebido] = campos
        if (!/^(?:\d+\/\d+|ENTRADA|Saldo Residual|(?:\d+º\s+)?BLOQ\. JUD)$/i.test(parcela) || atual.parcelas.some(item => item.numero === parcela)) {
          throw new Error('Identificador de parcela inválido ou repetido.')
        }
        atual.parcelas.push({ numero: parcela, vencimento: dataIso(vencimento), valor: centavos(valor),
          pagamento: pagamento ? dataIso(pagamento) : null, recebido: valorOpcional(recebido) })
      }
    }
    if (atual || !totalGeral) throw new Error('Página de acordos sem fechamento.')
  }
  return [...acordos.values()]
}

export async function coletarAcordosWebware(portal, acesso) {
  return comSessaoWebware(portal, acesso, async (page, config) => {
    const origem = new URL(page.url()).origin
    const link = page.locator('a[href*="/bin/rt/gAcordo.asp"]:visible').first()
    const endereco = new URL(await link.getAttribute('href'), page.url())
    if (endereco.origin !== origem || endereco.pathname !== '/bin/rt/gAcordo.asp') {
      throw new Error('Endereço de acordos divergente.')
    }
    await page.goto(endereco.href, { waitUntil: 'domcontentloaded' })
    const seletor = page.locator('select[name=FormUnidade]')
    const valor = await seletor.locator('option').filter({ hasText: /^todas(?: as)? unidades$/i }).getAttribute('value')
    if (!valor) throw new Error('Filtro de todas as unidades ausente.')
    await seletor.selectOption(valor)
    await page.getByRole('button', { name: /avançar/i }).click()
    await page.getByText(/Total Geral|Não há acordos registrados/i).first().waitFor()

    async function conferirContexto() {
      if (new URL(page.url()).origin !== origem || !config.identidade.test((await page.title()).trim()) ||
        !await page.getByText(tituloGrade).first().isVisible()) {
        throw new Error('Condomínio ou filtro da grade divergente.')
      }
    }
    await conferirContexto()
    if (await page.getByText(textoVazio, { exact: true }).isVisible()) return []
    const paginador = page.locator('select[name=page]')
    const tamanho = page.locator('select[name=iPageSize]')
    if (await paginador.locator('option').count() > 1 && await tamanho.locator('option[value="100"]').count()) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }), tamanho.selectOption('100')])
    }
    const numeros = await paginador.locator('option').evaluateAll(opcoes => opcoes.map(opcao => opcao.value))
    if (numeros.length > 200 || new Set(numeros).size !== numeros.length) throw new Error('Paginação de acordos inválida.')
    const paginas = []
    for (const numero of numeros.length ? numeros : [null]) {
      if (numero !== null && await paginador.inputValue() !== numero) {
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }), paginador.selectOption(numero)])
      }
      await conferirContexto()
      const linhas = await page.locator('#tableAcordo').evaluate(tabela =>
        [...tabela.querySelectorAll('tr')].map(linha => [...linha.cells].map(celula => celula.innerText.trim())))
      paginas.push({ numero, linhas })
    }
    return lerAcordosWebware(paginas, { incluirDetalhes: portal === 'atipass' })
  })
}
