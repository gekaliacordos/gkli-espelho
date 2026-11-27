import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { coletarWebwareNuvem } from './webware-nuvem.mjs'
import { centavos, dataIso } from './condopro.mjs'
import { lerAcordosWebware } from './webware-acordos.mjs'

const alvo = 'graiche-jerivas'
const capturas = []
function publicar(dados) {
  const chave = randomBytes(32), iv = randomBytes(12)
  const cifra = createCipheriv('aes-256-gcm', chave, iv)
  const criptografado = Buffer.concat([cifra.update(gzipSync(JSON.stringify(dados))), cifra.final()])
  const envelope = Buffer.concat([publicEncrypt({
    key: Buffer.from(process.env.PUBLIC_RESULT_KEY, 'base64'), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
  }, chave), iv, cifra.getAuthTag(), criptografado]).toString('base64')
  for (let i = 0; i < envelope.length; i += 2000) console.log('LELLO_FIN_' + i / 2000 + '=' + envelope.slice(i, i + 2000))
}

async function menu(page) {
  const menus = []
  for (const frame of page.frames()) {
    const lista = await frame.locator('a,button,[onclick]').evaluateAll(els => els.map(el => ({
      nome: (el.innerText || el.title || el.getAttribute('aria-label') || '').trim().slice(0,160),
      href: el.getAttribute('href'), acao: el.getAttribute('onclick'),
    })).filter(el => el.nome && /acord|negoci|recibo|finance|cobran|extrato|relat|demonstr|honor|repasse|composi|hist[oó]r|pagament|via|boleto|pend.n|prest|document/i.test(el.nome))).catch(() => [])
    menus.push(...lista)
  }
  return menus
}
async function consulta(page, abrir) {
  await page.locator('a[href="/bin/rt/gAcordo.asp"]').first().waitFor({state:'attached',timeout:15000}).catch(() => {})
  const antes = await menu(page)
  capturas.push({ antes })
  await abrir()
  const durante = await menu(page)
  const tabela = page.locator('#tableAcordo')
  await tabela.waitFor({ state: 'attached', timeout: 75000 })
  const paginador = page.locator('select[name=page]')
  const opcoes = await paginador.locator('option').evaluateAll(xs => xs.map(x => x.value))
  if (opcoes.length > 200 || new Set(opcoes).size !== opcoes.length) throw Error('Paginação inválida')
  const paginas = []
  for (const numero of opcoes.length ? opcoes : [null]) {
    if (numero !== null && await paginador.inputValue() !== numero) {
      const anterior = await tabela.innerText()
      await paginador.selectOption(numero)
      await page.waitForFunction(t => {
        const atual = document.querySelector('#tableAcordo')?.innerText
        return atual && atual !== t && atual.includes('Total Geral')
      }, anterior, { timeout: 45000 })
    }
    const pagina = await tabela.evaluate(t => [...t.querySelectorAll('tr')].map(r => ({
      linha: [...r.cells].map(c => c.innerText.trim()),
      controles: [...r.querySelectorAll('a,button,[onclick]')].map(el => ({
        nome: (el.innerText || el.title || el.getAttribute('aria-label') || '').trim().slice(0,120),
        href: el.getAttribute('href'), acao: el.getAttribute('onclick'),
      })),
    })))
    paginas.push(pagina)
  }
  const acordos = lerAcordosWebware(paginas.map(p => ({ linhas: p.map(r => r.linha) })))
  const ativos = acordos.filter(a => a.saldo > 0)
  const ids = new Set(ativos.map(a => a.unidade + ':' + a.numero))
  const linhas = paginas.flat().filter(r => ids.has(r.linha[0] + '/' + r.linha[1] + ':' + r.linha[2]))
    .map(r => ({ unidade: r.linha[0] + '/' + r.linha[1], numero: r.linha[2], principalExibido: r.linha[4], controles: r.controles }))
  capturas.push({ durante, ativos, linhas, situacoes: acordos.map(({unidade,numero,saldo,recebido,total})=>({unidade,numero,saldo,recebido,total})), pagina: new URL(page.url()).pathname })
  console.log('Grade Graiche conferida:', ativos.length, 'com saldo em aberto.')
}
try {
  const perfis = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64, 'base64')).graiche
  await coletarWebwareNuvem('graiche', perfis, (codigo, nome, acessar) => codigo === alvo ? acessar() : undefined, consulta)
} catch {
  capturas.push({ erro: 'O portal ou a grade interrompeu a consulta.' })
  console.log('Consulta interrompida em etapa de navegação ou validação.')
}
publicar(capturas)
