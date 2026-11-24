import { chromium } from 'playwright'
import { centavos, dataIso } from './condopro.mjs'

const origem = 'https://app.winker.com.br'

function lerInadimplencia(texto) {
  if (!/^Condomínio: VISO MOEMA\s*$/m.test(texto)) throw Error('Identidade do relatório OMA divergente.')
  const cotas = [], unidades = [], chaves = new Set()
  const valores = linha => [...linha.matchAll(/-?[\d.]+,\d{2}/g)].map(m => centavos(m[0]))
  const somar = itens => itens.reduce((a, c) => a.map((v, i) => v + c[i]), [0, 0, 0, 0, 0, 0])
  const conferir = (a, b) => {
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw Error('Totais da OMA divergentes.')
  }
  const totais = []
  let unidade, recibo, linhas = [], fechamento
  for (const linha of texto.split('\n').map(s => s.trim())) {
    const id = linha.match(/^Bloco (.+?) - Unidade (\S+)\s*:/)
    const detalhe = linha.match(/^(\d+)\s*(J?)\t(\d{2}\/\d{2}\/\d{4})\t/)
    if (id) {
      if (unidade || recibo) throw Error('Unidade sem subtotal.')
      unidade = id.slice(1).join(' / ')
      unidades.push(unidade)
    } else if (detalhe) {
      if (!unidade || recibo) throw Error('Recibo sem subtotal.')
      recibo = detalhe
    } else if (linha.startsWith('Total do recibo:')) {
      const v = valores(linha), chave = unidade + ':' + recibo?.[1]
      if (!recibo || chaves.has(chave) || v.length !== 6) throw Error('Recibo inválido.')
      chaves.add(chave)
      linhas.push(v)
      cotas.push({ unidade, recibo: recibo[1], vencimento: dataIso(recibo[3]), valores: v.slice(1), valorOriginal: v[0], marcacaoOrigem: recibo[2] || null })
      recibo = null
    } else if (linha.startsWith('Total da unidade:')) {
      if (!unidade || recibo || !linhas.length) throw Error('Subtotal de unidade inválido.')
      const v = valores(linha)
      conferir(v, somar(linhas))
      totais.push(v)
      unidade = null
      linhas = []
    } else if (linha.startsWith('Total acumulado:')) {
      conferir(valores(linha), somar(totais))
      fechamento = true
    }
  }
  if (!fechamento || unidade || recibo || unidades.length !== Number(texto.match(/Total de unidades inadimplentes:\s*(\d+)/)?.[1])) {
    throw Error('Relatório de inadimplência da OMA incompleto.')
  }
  return { cotas, unidades, contatos: [] }
}

export async function coletarOma(credenciais, visitar) {
  await visitar('oma-22785', 'Viso Moema', async etapa => {
    const cotas = await etapa('cotas', async () => {
      const browser = await chromium.launch({ channel: 'chrome', headless: true })
      let fase = 'abertura'
      try {
        const pagina = await browser.newPage()
        await pagina.goto('https://oma.com.br/condominios/', { waitUntil: 'domcontentloaded' })
        await pagina.locator('.e-n-accordion-item-title-text').filter({ hasText: /^\s*Condomínios\s*$/ }).filter({ visible: true }).first().click()
        const form = pagina.locator('form[action="https://app.winker.com.br/intra/default/login?wl=oma"]').filter({ visible: true }).first()
        await form.locator('input[name="LoginForm[username]"]').fill(credenciais.usuario)
        await form.locator('input[name="LoginForm[password]"]').fill(credenciais.senha)
        await form.locator('button[type=submit]').click()
        await pagina.waitForURL(u => u.origin === origem && u.pathname.endsWith('/escolherPortal'))
        fase = 'seleção de Viso Moema'
        const vinculos = pagina.locator('a[href*="changeCondominioPadrao/id/22785"]')
        await vinculos.first().waitFor({ state: 'attached' })
        const links = await vinculos.evaluateAll(es => [...new Set(es.filter(e =>
          e.origin === 'https://app.winker.com.br'
          && e.pathname === '/intra/default/changeCondominioPadrao/id/22785'
          && /^VISO MOEMA(?:\s|$)/i.test(e.innerText.trim()))
          .map(e => e.origin + e.pathname))])
        if (links.length !== 1 || new URL(links[0]).origin !== origem) throw Error('Vínculo de Viso Moema indisponível.')
        await pagina.goto(links[0], { waitUntil: 'domcontentloaded' })
        await pagina.goto(origem + '/intra', { waitUntil: 'domcontentloaded' })
        await pagina.locator('a:visible').filter({ hasText: /Balancete interativo/i }).first().click()
        fase = 'balancete interativo'
        const financeiro = pagina.frameLocator('iframe[src*="appweb.winker.com.br"]').first()
        await financeiro.getByText('Relatórios', { exact: true }).first().click({ timeout: 50_000 })
        const popup = pagina.context().waitForEvent('page', { timeout: 50_000 })
        popup.catch(() => {})
        await financeiro.getByText('Inadimplentes', { exact: true }).first().click()
        fase = 'relatório de inadimplência'
        const relatorio = await popup
        await relatorio.getByText(/Total de unidades inadimplentes:/i).first().waitFor()
        if (new URL(relatorio.url()).origin !== origem) throw Error('Origem do relatório OMA divergente.')
        return lerInadimplencia(await relatorio.locator('body').innerText())
      } catch (erro) {
        console.error('OMA:', fase, erro.name === 'TimeoutError' ? 'tempo esgotado' : 'falhou')
        throw erro
      } finally {
        await browser.close()
      }
    })
    return { cotas }
  })
}
