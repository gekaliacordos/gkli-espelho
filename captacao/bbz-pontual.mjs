import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { coletarWebwareNuvem } from './webware-nuvem.mjs'
import { centavos, dataIso } from './condopro.mjs'
import { lerAcordosWebware } from './webware-acordos.mjs'

const alvo = process.argv[2]
if (!/^bbz-\d+$/.test(alvo ?? '')) throw Error('Alvo inválido')
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

async function consulta(page, abrir) {
  await abrir()
  const vazio = page.getByText('Não há acordos registrados.', {exact:true}).first()
  await page.getByText(/Total Geral|Não há acordos registrados/i).first().waitFor({timeout:75000})
  if (await vazio.isVisible()) {
    capturas.push({ ativos: [], quitados: [] }, { vinculos: [], falhas: 0, unidades: 0, motivos: {} })
    return
  }
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
    const resumo = ({unidade,numero,total,recebido,saldo}) => ({unidade,numero,total,recebido,saldo})
  capturas.push({ ativos: ativos.map(a=>({...resumo(a),parcelas:a.parcelas.length})),
    quitados: acordos.filter(a=>a.saldo===0&&a.total>0&&a.total===a.recebido).map(resumo) })
  capturas.push({situacoes: acordos.map(({unidade,numero,total,recebido,saldo,situacao,parcelas}) =>
    ({unidade,numero,total,recebido,saldo,situacao,parcelas})) })
}
try {
  const perfis = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64, 'base64')).bbz
  await coletarWebwareNuvem('bbz', perfis, (codigo, nome, acessar) => codigo === alvo ? acessar() : undefined, consulta)
} catch {
  capturas.push({ erro: 'O portal ou a grade interrompeu a consulta.' })
  console.log('Consulta interrompida em etapa de navegação ou validação.')
}
publicar({alvo, capturas})
