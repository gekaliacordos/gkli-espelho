import { open } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setTimeout as esperar } from 'node:timers/promises'

const origem = 'https://sys.livefacilities.com.br'
const devedores = '/Operacional/Empreendimento/Emp_DevedoresRelatorio.aspx?menu=kBBnlhU1rzTUaiO%2BpAhtmQ%3D%3D'
const acordos = '/Operacional/Empreendimento/Emp_BoletoAcordolista.aspx?menu=MKvPqNDN3JSoAv4X/J1moA=='
const prazo = 180_000
const filtro = '#body_ucFiltroRelatorioDevedores_'

async function selecionarEmpreendimento(page, alvo) {
  await page.goto(origem + acordos, { waitUntil: 'domcontentloaded' })
  const empreendimento = page.locator('#tbNmEmpreendimento')
  await empreendimento.fill(alvo.codigoPortal)
  await empreendimento.press('Enter')
  await page.waitForFunction(({ codigoPortal, nomePortal }) => {
    const texto = document.querySelector('#tbNmEmpreendimento')?.value ?? ''
    const selecionado = document.querySelector('#ddEmpreendimento')?.selectedOptions[0]?.text ?? ''
    const prefixo = codigoPortal + ' - ' + nomePortal
    return texto.trim() === prefixo && selecionado.trim() === prefixo
  }, alvo, { timeout: 30_000 })

  // A busca preenche a seleção visual. A abertura do Home grava o empreendimento na sessão.
  const home = page.waitForURL(url => url.origin === origem &&
    url.pathname === '/Operacional/Empreendimento/Empreendimento.aspx', { timeout: 45_000 })
  home.catch(() => {})
  await page.locator('#lkHomeEmpreendimento').click()
  await home
  await page.waitForLoadState('domcontentloaded')
}

async function abrirRelatorio(page, rota, alvo) {
  await page.goto(origem + rota, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(bloco => [...(document.querySelector('#ddBlocoMaster')?.options ?? [])]
    .some(b => b.textContent.trim().endsWith(' - ' + bloco)), alvo.bloco, { timeout: 30_000 })
}

async function validarXls(download, caminho) {
  await download.saveAs(caminho)
  if (await download.failure()) throw Error('Exportação do HFlex falhou.')
  const arquivo = await open(caminho)
  try {
    const cabecalho = Buffer.alloc(8192)
    const { bytesRead } = await arquivo.read(cabecalho)
    const html = /<table\b/i.test(cabecalho.subarray(0, bytesRead).toString('utf8'))
    const pdf = cabecalho.subarray(0, 4).toString() === '%PDF'
    return html && !pdf
  } finally {
    await arquivo.close()
  }
}

async function exportarXls(page, botao, caminho, rota, titulo, alvo) {
  const context = page.context()
  const downloads = []
  const ouvintes = new Set()
  const novasAbas = new Set()
  const receber = download => downloads.push(download)
  const observar = aba => {
    ouvintes.add(aba)
    aba.on('download', receber)
  }
  const novaAba = aba => {
    novasAbas.add(aba)
    observar(aba)
  }
  observar(page)
  context.on('page', novaAba)
  const prazoFinal = Date.now() + prazo
  let acionado = false
  try {
    await page.locator(botao).click()
    while (Date.now() < prazoFinal) {
      for (const download of downloads.splice(0)) {
        if (await validarXls(download, caminho)) return
      }
      if (!acionado) {
        for (const aba of [page, ...novasAbas]) {
          if (aba.isClosed()) continue
          for (const frame of aba.frames()) {
            if (!frame.url().startsWith(origem + "/")) continue

            const url = new URL(frame.url())
            if (url.origin !== origem || !rota.test(url.pathname)) continue
            const seletor = '#btRelatorioExcel'
            const baixar = frame.locator(seletor).first()
            if (!await baixar.isVisible() || !await frame.getByText(titulo).first().isVisible()) continue
            const identidade = alvo.codigoPortal + ' - ' + alvo.nomePortal
            if (!await frame.getByText(identidade).count()) throw Error('O visualizador não identificou o empreendimento ' + alvo.codigoPortal + '.')
            if (frame === aba.mainFrame()) {
              await baixar.click()
            } else {
              // O visualizador incorporado pode bloquear downloads. Use seu endereço
              // já emitido pelo portal na mesma sessão, em uma página própria.
              const visualizador = await context.newPage()
              await visualizador.goto(url.href, { waitUntil: 'domcontentloaded' })
              await visualizador.getByText(identidade).first().waitFor({ timeout: 30_000 })
              await visualizador.locator(seletor).first().click()
            }
            acionado = true
            break
          }
          if (acionado) break
        }
      }
      await esperar(350)
    }
    throw Error('O HFlex não concluiu a exportação no formato solicitado.')
  } finally {
    context.off('page', novaAba)
    for (const aba of ouvintes) aba.off('download', receber)
    await Promise.all([...novasAbas].map(aba => aba.close().catch(() => {})))
  }
}

async function configurarAcordos(page, alvo) {
  await abrirRelatorio(page, acordos, alvo)
  await page.locator('#body_tbNumeroAcordo').fill('')
  await page.locator('#body_tbDataInicioVencimento').fill('')
  await page.locator('#body_tbDataFinalVencimento').fill('')
  await page.locator('#body_ddBloco').selectOption({ label: '---' })
  await page.locator('#body_ddUnidade').selectOption({ label: '---' })
  // Repete o recorte conferido no XLS manual, com unidades e contratos.
  const status = [true, false, false, true, true, false, true]
  for (const [indice, marcado] of status.entries()) {
    await page.locator('#body_rpAcordoStatus_ckAcordoStatusIndividual_' + indice).setChecked(marcado)
  }
  await page.locator('#body_ckExibeAcordoUnidade').check()
  await page.locator('#body_ckExibeAcordoContrato').check()
}

export async function baixarRelatoriosHflex({ usuario, senha }, caminhos, alvo, progresso = () => {}) {
  if (!usuario || !senha) throw Error('Credenciais do HFlex ausentes.')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    context.setDefaultTimeout(30_000)
    const page = await context.newPage()
    progresso('autenticação')
    await page.goto(origem + '/Index.aspx', { waitUntil: 'domcontentloaded' })
    if (new URL(page.url()).origin !== origem) throw Error('Origem do formulário divergente.')
    await page.getByPlaceholder('login', { exact: true }).fill(usuario)
    await page.getByPlaceholder('senha', { exact: true }).fill(senha)
    await page.getByRole('button', { name: /^Entrar$/i }).click()
    const perfil = page.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'ADVOGADO EXTERNO' }) })
    await perfil.selectOption({ label: 'ADVOGADO EXTERNO' })
    await page.getByRole('button', { name: /^Acessar$/i }).click()
    await page.waitForURL(url => url.origin === origem && url.pathname.startsWith('/Operacional/'))

    progresso('relatórios de acordos')
    await selecionarEmpreendimento(page, alvo)
    await configurarAcordos(page, alvo)
    progresso('XLS de acordos')
    await exportarXls(page, '#body_btRelatorioSintetico', caminhos.sintetico, /RelatorioAcordoSintetico/i, /RELATÓRIO DE ACORDOS\s*-\s*SINTÉTICO/i, alvo)
    progresso('relatório de devedores')
    const paginaDevedores = await context.newPage()
    await abrirRelatorio(paginaDevedores, devedores, alvo)
    // Preserva os dois tipos de recibos. O parser separa os vínculos confirmados.
    for (const id of ['ckAcordo', 'ckSemAcordo', 'ckPDF']) await paginaDevedores.locator(filtro + id).setChecked(false)
    for (const id of ['cbValorCorrigido', 'ckExcelCabecalho', 'ckExcel']) await paginaDevedores.locator(filtro + id).setChecked(true)
    await exportarXls(paginaDevedores, filtro + 'btGeraRelatorioDetalhado', caminhos.devedores, /RelatorioDevedores/i, /DEVEDORES DETALHADO/i, alvo)
  } finally {
    await browser.close()
  }
}
