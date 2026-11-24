import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { lerInadimplenciaCondoPro } from './condopro.mjs'

export const configuracoesWebware = {
  atipass: { nome: 'Residencial das Ilhas', adm: 'Atipass', identidade: /\bILHAS\b/i, relatorio: 'ILHAS',
    url: 'https://www.atipass.com.br/', hosts: ['servc7-1.webware.com.br'] },
  villagua: { nome: 'Square Guarulhos', adm: 'Villágua', identidade: /SQUARE GUARULHOS/i, relatorio: 'SQUARE GUARULHOS',
    url: 'https://servc9-1.webware.com.br/bin/administradora/default.asp', hosts: ['servc9-1.webware.com.br'] },
  sell: { nome: 'Parc Exclusif Perdizes', adm: 'Sell', identidade: /^EDIFICIO PARC EXCLUSIF PERDIZES$/i, relatorio: 'PARC EXCLUSIF PERDIZES',
    url: 'https://selladm.com.br/', hosts: ['servc9.webware.com.br', 'servc9-1.webware.com.br'] },
}

function menuCotas(page) {
  return page.getByText(/cotas\s+pendentes|^pendentes$/i).filter({ visible: true }).first()
}

async function selecionarSessao(context, config) {
  for (let tentativa = 0; tentativa < 24; tentativa++) {
    for (const page of context.pages()) {
      const url = new URL(page.url())
      if (url.protocol !== 'https:' || !config.hosts.includes(url.hostname)) continue
      const titulo = (await page.title()).trim()
      if (config.identidade.test(titulo) && await menuCotas(page).isVisible()) return page
    }
    await new Promise(resolve => setTimeout(resolve, 1250))
  }
  throw new Error('O portal não confirmou a identidade do condomínio e o menu de cotas.')
}

export async function coletarWebware(portal, { usuario, senha }) {
  const config = configuracoesWebware[portal]
  if (!config || !usuario || !senha) throw new Error('Configuração ou acesso Webware ausente.')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    let page = await context.newPage()
    page.setDefaultTimeout(20_000)
    await page.goto(config.url, { waitUntil: 'domcontentloaded' })
    if (portal === 'atipass') {
      const abrir = page.waitForEvent('popup', { timeout: 6000 }).catch(() => null)
      await page.getByText(/^[ÁA]rea\s+do\s+Cliente$/i).filter({ visible: true }).first().click()
      page = await abrir || page
    }
    const login = new URL(page.url())
    if (login.protocol !== 'https:' || ![new URL(config.url).hostname, ...config.hosts].includes(login.hostname)) {
      throw new Error('Origem do formulário Webware divergente.')
    }
    const senhaInput = page.locator('input[type=password]:visible').first()
    await senhaInput.waitFor()
    await page.locator('input[type=text]:visible,input[type=email]:visible,input:not([type]):visible').first().fill(usuario)
    await senhaInput.fill(senha)
    const entrar = page.getByRole('button', { name: /entrar|acessar|login/i }).first()
    if (await entrar.isVisible()) await entrar.click()
    else await senhaInput.press('Enter')

    page = await selecionarSessao(context, config)
    const endereco = new URL('/bin/rt/rtPendentes.asp', page.url())
    const href = await menuCotas(page).getAttribute('href')
    if (href) {
      const link = new URL(href, page.url())
      if (link.origin === endereco.origin && link.pathname === endereco.pathname) endereco.search = link.search
    }
    await page.goto(endereco.href, { waitUntil: 'domcontentloaded' })
    const atual = new URL(page.url())
    if (atual.origin !== endereco.origin || !config.identidade.test((await page.title()).trim())) {
      throw new Error('A consulta de cotas saiu do condomínio confirmado.')
    }
    const filtro = page.locator('select').first()
    if (portal === 'sell' && !await filtro.count() && atual.pathname === '/bin/skin/aInicioSkin.asp'
      && await menuCotas(page).isVisible()) {
      return {
        unidades: [], contatos: [], cotas: [], acordos: [],
        cobertura: 'O portal retornou ao menu de cotas após a consulta. Não gerou relatório; a ausência de cotas em aberto ainda requer confirmação.',
        cotasVerificadas: false,
      }
    }

    const todas = await filtro.locator('option').filter({ hasText: /todas(?: as)? unidades/i }).getAttribute('value')
    if (todas === null) throw new Error('Filtro de todas as unidades indisponível.')
    await filtro.selectOption(todas)
    await page.getByRole('button', { name: /consultar|avançar/i }).or(page.getByText(/^Consultar$/i)).first().click()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    download.catch(() => {})
    await page.getByText(/exportar excel/i).or(page.getByRole('button', { name: /exportar excel/i })).first().click()
    const arquivo = await (await download).path()
    return lerInadimplenciaCondoPro(await readFile(arquivo), config.relatorio)
  } finally {
    await browser.close()
  }
}
