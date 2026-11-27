import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { dataIso } from './condopro.mjs'
import { filtrarWebware, lerCotasWebware } from './webware-nuvem.mjs'

import { interpretarTabela } from './manager-grade.mjs'

const portal = 'https://www.manageradm.com.br/atentum/'
const origem = 'https://atentum-s9.webware.com.br'
export const alvosManager = JSON.parse(await readFile(new URL('./alvos-manager.json', import.meta.url)))
const codigo = texto => String(texto).replace(/^0+(?=\d)/, '')

async function encontrarFrame(pagina, condicao) {
  const prazo = Date.now() + 45_000
  do {
    for (const frame of pagina.frames()) {
      if (frame.url().startsWith(origem + '/') && await condicao(frame).catch(() => false)) return frame
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  } while (Date.now() < prazo)
  throw Error('Tela esperada da Manager não apareceu.')
}

export async function coletarManager(credenciais, visitar) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const pagina = await browser.newPage({ acceptDownloads: true })
  pagina.setDefaultTimeout(30_000)
  try {
    await pagina.goto(portal, { waitUntil: 'domcontentloaded' })
    if (new URL(pagina.url()).origin !== new URL(portal).origin) throw Error('Origem do login divergente.')
    await pagina.locator('input[type=text]:visible').first().fill(credenciais.usuario)
    await pagina.locator('input[type=password]:visible').first().fill(credenciais.senha)
    await pagina.getByRole('button', { name: /^Entrar$/i }).click()
    await pagina.waitForURL(url => url.origin === origem)
    for (const alvo of alvosManager) {
      await visitar('manager-' + alvo.codigo, alvo.nome, async etapa => {
        const cliente = await encontrarFrame(pagina, f => f.locator('input[name=c]').first().isVisible())
        await cliente.locator('input[name=c]').first().fill(alvo.codigo)
        await cliente.locator('input[name=acao][type=submit]').first().click()
        const menu = await encontrarFrame(pagina, async f => {
          if (!await f.locator('select[name=Conteudo]').isVisible()) return false
          return codigo((await f.locator('body').innerText()).match(/Ocorrências\s*\|\s*Usuários\s*\|\s*(\d+)\s*-/i)?.[1]) === alvo.codigo
        })
        const cotas = await etapa('cotas', async () => {
          const frame = pagina.frame({ name: 'conteudo' })
          await frame.goto(origem + '/bin/rt/rtPendentes.asp?u=', { waitUntil: 'domcontentloaded' })
          await filtrarWebware(frame)
          const titulo = await frame.getByText(new RegExp('Condom[ií]nio:\\s*0*' + alvo.codigo + '\\s*-', 'i')).first().innerText()
          return lerCotasWebware(frame, titulo.replace(/^.*?Condom[ií]nio:\s*\d+\s*-\s*/i, '').trim())
        })
        const acordos = await etapa('acordos', async () => {
          const mudou = pagina.waitForEvent('framenavigated', {
            predicate: f => f.name() === 'conteudo' && f.url().startsWith(origem + '/bin/rt/gAcordo.asp'),
          })
          mudou.catch(() => {})
          await menu.locator('select[name=Conteudo]').selectOption({ label: 'Acordos Online' })
          const frame = await mudou
          await filtrarWebware(frame)
          await frame.getByText(/Total Geral|Não há acordos registrados/i).first().waitFor({ timeout: 75_000 })
          const paginador = frame.locator('select[name=page]')
          const numeros = await paginador.locator('option').evaluateAll(es => es.map(e => e.value))
          if (numeros.length > 200 || new Set(numeros).size !== numeros.length) throw Error('Paginação da Manager inválida.')
          const acordos = []
          const processos = new Set()
          for (const numero of numeros.length ? numeros : [null]) {
            if (numero !== null && await paginador.inputValue() !== numero) {
              const anterior = await frame.locator('#tableAcordo').innerText()
              await paginador.selectOption(numero)
              await frame.waitForFunction(anterior => {
                const tabela = document.querySelector('#tableAcordo')?.innerText
                return tabela && tabela !== anterior && tabela.includes('Total Geral')
              }, anterior, { timeout: 45_000 })
            }
            const leitura = await frame.evaluate(() => {
              const texto = document.body.innerText
              const tabela = [...document.querySelectorAll('table')].find(t => /Bloco[\s\S]*Unidade[\s\S]*Processo[\s\S]*Parcela/.test(t.innerText))
              return {
                valido: texto.includes('Acompanhamento de Acordo: Somente em Aberto'),
                vazio: /nenhum acordo|não (?:há|existem) acordos|sem acordos/i.test(texto),
                linhas: tabela ? [...tabela.rows].map(r => [...r.cells].map(c => ({ texto: c.innerText.trim(), colspan: c.colSpan }))) : null,
              }
            })
            if (!leitura.valido || (!leitura.linhas && !leitura.vazio)) throw Error('Recorte da grade não confirmado.')
            if (!leitura.linhas) continue
            for (const acordo of interpretarTabela(leitura.linhas, { vazioConfirmado: leitura.vazio }).acordos) {
              const id = [acordo.bloco, acordo.unidade, acordo.processo].join(':')
              if (processos.has(id)) throw Error('Processo repetido na grade da Manager.')
              processos.add(id)
              acordos.push(acordo)
            }
          }
          return acordos.map(a => {
            const periodo = a.periodo.split(/\s+a\s+/i)
            return {
              unidade: a.bloco + '/' + a.unidade, numero: a.processo, principal: a.valor_principal_centavos,
              total: a.total.valor_centavos, recebido: a.total.recebido_centavos, saldo: a.total.saldo_centavos,
              situacao: a.total.saldo_centavos > 0 ? 'Com saldo em aberto'
                  : a.total.saldo_centavos < 0 ? 'Saldo credor' : 'Saldo zerado',
              periodoNegociado: periodo.length === 2 ? { inicio: dataIso(periodo[0]), fim: dataIso(periodo[1]) } : null,
              parcelas: a.parcelas.map(p => ({
                numero: p.parcela, vencimento: dataIso(p.vencimento), valor: p.valor_centavos,
                pagamento: p.data_recebimento ? dataIso(p.data_recebimento) : null, recebido: p.recebido_centavos,
              })),
            }
          })
        })
        return { cotas, acordos }
      })
    }
  } finally {
    await browser.close()
  }
}
