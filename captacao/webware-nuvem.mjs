import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { lerInadimplenciaCondoPro } from './condopro.mjs'
import { lerAcordosWebware } from './webware-acordos.mjs'

const hosts = new Set(['servc9.webware.com.br', 'servc9-1.webware.com.br'])
const clientes = { bbz: '52207487', graiche: '44023323' }
export const normalizar = texto => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '')
const todas = /^todas(?: as)? unidades$/i

export const alvosBbZ = [
  [1380, 'CONDOMINIO COMODITA CLUB RESIDENCE'], [650, 'CONDOMINIO EDIFICIO ESTACAO GABRIELE'],
  [1207, 'CONDOMINIO EXTENSION BERRINI'], [1532, 'PANORAMA VILA ROMANA'],
  [820, 'CLOCK VILA ROMANA'], [1158, 'COND ELO DUO CAMINHOS DA LAPA SETOR 3'],
  [1843, 'CONDOMINIO BEM MOEMA - COMERCIAL'], [1844, 'CONDOMINIO BEM MOEMA - LOJAS'],
  [1841, 'CONDOMINIO BEM MOEMA - RESIDENCIAL'], [1842, 'CONDOMINIO BEM MOEMA - STUDIOS'],
  [1792, 'CONDOMINIO EDIFICIO L AVANCE MORUMBI'], [728, 'CONDOMINIO WEST SIDE- SANTO AMARO'],
  [1220, 'GALERIA 90'], [1869, 'HI VIEW ALTO DA BOA VISTA - RESIDENCIAL'],
  [1838, 'K 360 HUMBERTO I - SUBCOND COMERCIAL'], [1839, 'K 360 HUMBERTO I - SUBCOND LOJAS'],
  [1837, 'K 360 HUMBERTO I - SUBCOND RESIDENCIAL'],
  [1680, 'LIVING WELLNESS ACLIMACAO - SUBCOND 1'], [1681, 'LIVING WELLNESS ACLIMACAO - SUBCOND 2'],
  [1682, 'LIVING WELLNESS ACLIMACAO - SUBCOND 3'], [1683, 'LIVING WELLNESS ACLIMACAO - SUBCOND 4'],
  [1679, 'LIVING WELLNESS ACLIMACAO CENTRAL'], [1341, 'VIVAZ ESTACAO VILA PRUDENTE'],
]

export async function lerCotasWebware(pagina, titulo) {
  const btn = pagina.getByText(/Exportar Excel/i).first()
  await btn.waitFor({ timeout: 75_000 })
  const dono = pagina.page ? pagina.page() : pagina
  const download = dono.waitForEvent('download', { timeout: 45_000 })
  download.catch(() => {})
  await btn.click()
  const bytes = await readFile(await (await download).path())
  const html = new TextDecoder('windows-1252').decode(bytes)
  const cabecalho = html.match(/Condom[ií]nio:\s*(\d+)\s*-\s*([^<]+)/i)
  if (cabecalho && normalizar(cabecalho[2]) === normalizar(titulo)
      && />\s*Não consta pendência no período\s+01\/01\/1900\b[^<]*</i.test(html)
      && [...html.matchAll(/<tr\b/gi)].length === 3) {
    return { cotas: [], unidades: [], contatos: [] }
  }
  return lerInadimplenciaCondoPro(bytes, titulo)
}

export async function filtrarWebware(pagina) {
  const filtro = pagina.locator('select').filter({ has: pagina.locator('option').filter({ hasText: todas }) }).first()
  const opcao = filtro.locator('option').filter({ hasText: todas })
  await opcao.waitFor({ state: 'attached' })
  await filtro.selectOption(await opcao.getAttribute('value') ?? '')
  await pagina.getByRole('button', { name: /Consultar|Avançar/i }).first().click()
}

export async function lerGradeWebware(pagina) {
  const vazio = pagina.getByText('Não há acordos registrados.', { exact: true }).first()
  await pagina.getByText(/Total Geral|Não há acordos registrados/i).first().waitFor({ timeout: 75_000 })
  const cabecalho = await pagina.getByText(/Acompanhamento de Acordo: (?:Somente em Aberto|Aberto e Baixado)/i).first().count()
  if (!cabecalho) throw Error('Recorte da grade indisponível.')
  if (await vazio.isVisible()) return []
  const tabela = pagina.locator('#tableAcordo')
  const paginador = pagina.locator('select[name=page]')
  const numeros = await paginador.locator('option').evaluateAll(xs => xs.map(x => x.value))
  if (numeros.length > 200 || new Set(numeros).size !== numeros.length) throw Error('Paginação inválida.')
  const paginas = []
  for (const numero of numeros.length ? numeros : [null]) {
    if (numero !== null && await paginador.inputValue() !== numero) {
      const anterior = await tabela.innerText()
      await paginador.selectOption(numero)
      await pagina.waitForFunction(texto => {
        const atual = document.querySelector('#tableAcordo')?.innerText
        return atual && atual !== texto && atual.includes('Total Geral')
      }, anterior, { timeout: 45_000 })
    }
    const linhas = await tabela.evaluate(t => [...t.querySelectorAll('tr')]
      .map(r => [...r.cells].map(c => c.innerText.trim())))
    paginas.push({ linhas })
  }
  return lerAcordosWebware(paginas)
}

export async function coletarWebwareNuvem(portal, credenciais, visitar, consultaPontual) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const pagina = await browser.newPage({ acceptDownloads: true })
  pagina.setDefaultTimeout(30_000)
  try {
    await pagina.goto('https://servc9-1.webware.com.br/bin/administradora/default.asp?adm=' + clientes[portal],
      { waitUntil: 'domcontentloaded' })
    if (!hosts.has(new URL(pagina.url()).hostname)) throw Error('Origem de login divergente.')
    await pagina.locator('input[name=mem]:visible').fill(credenciais.usuario)
    await pagina.locator('input[name=pass]:visible').fill(credenciais.senha)
    await pagina.getByRole('button', { name: /^Entrar$/i }).click()
    await pagina.locator('.card .txt-titulo').first().waitFor({ timeout: 45_000 })
    const lista = pagina.url()
    if (new URL(lista).protocol !== 'https:' || !hosts.has(new URL(lista).hostname)) throw Error('Relação de condomínios fora da origem.')
    const alvos = portal === 'bbz' ? alvosBbZ : [[null, 'CAMINHOS DA LAPA JERIVAS']]
    if (portal === 'bbz' && consultaPontual && process.argv[2] === 'bbz-1880') {
      const extras = await pagina.locator('.card').evaluateAll(cards => cards.flatMap(card => {
        const codigo = [...card.querySelectorAll('[onclick]')].some(el =>
          /AcessarVinculo\(['"]1880['"]/.test(el.getAttribute('onclick') ?? ''))
        const titulo = card.querySelector('.txt-titulo')?.innerText.trim()
        return codigo && titulo ? [titulo] : []
      }))
      if (extras.length === 1 && /PARQUE.*CIP[OÓ]/i.test(extras[0])) {
        await visitar('bbz-1880',extras[0],async etapa => entrarCondominio(1880, extras[0], etapa))
      }
    }
    async function entrarCondominio(codigoEsperado, titulo, etapa) {
        if (pagina.url() !== lista) await pagina.goto(lista, { waitUntil: 'domcontentloaded' })
        const cartao = pagina.locator('.card').filter({ has: pagina.locator('.txt-titulo').getByText(titulo, { exact: true }) })
        await cartao.waitFor()
        const entrar = cartao.getByText('Acessar', { exact: true })
        const codigo = (await entrar.getAttribute('onclick'))?.match(/AcessarVinculo\(['"](\d+)['"]/)?.[1]
        if (codigoEsperado && Number(codigo) !== codigoEsperado) throw Error('Código do vínculo divergente.')
        await entrar.click()
        await pagina.waitForFunction(({ titulo, hosts }) => hosts.includes(location.hostname) &&
          document.title.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '') === titulo,
        { titulo: normalizar(titulo), hosts: [...hosts] })
        const origem = new URL(pagina.url()).origin
        const abrir = async rota => {
          await pagina.goto(origem + rota, { waitUntil: 'domcontentloaded' })
          if (new URL(pagina.url()).origin !== origem || normalizar(await pagina.title()) !== normalizar(titulo)) {
            throw Error('Condomínio do relatório divergente.')
          }
          await filtrarWebware(pagina)
          if (new URL(pagina.url()).origin !== origem || normalizar(await pagina.title()) !== normalizar(titulo)) {
            throw Error('Condomínio do resultado divergente.')
          }
        }
        if (consultaPontual) return consultaPontual(pagina, () => abrir('/bin/rt/gAcordo.asp'))
        const cotas = await etapa('cotas', async () => {
          await abrir('/bin/rt/rtPendentes.asp')
          return lerCotasWebware(pagina, titulo)
        })
        const acordos = await etapa('acordos', async () => {
          await abrir('/bin/rt/gAcordo.asp')
          return lerGradeWebware(pagina)
        })
        return { cotas, acordos }
    }
    for (const [codigoEsperado,titulo] of alvos) {
      await visitar(codigoEsperado ? portal + '-' + codigoEsperado : 'graiche-jerivas',titulo,
        etapa => entrarCondominio(codigoEsperado,titulo,etapa))
    }
  } finally {
    await browser.close()
  }
}
