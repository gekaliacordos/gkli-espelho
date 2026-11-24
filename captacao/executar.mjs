import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { coletarEspelhoLello } from './lello.mjs'

const { AGENTE_LELLO_SAFIRA_USUARIO: usuario, AGENTE_LELLO_SAFIRA_SENHA: senha, ESPELHO_DATABASE_URL } = process.env
const codigo = '63004'
const nome = 'Safira'

try {
  if (!ESPELHO_DATABASE_URL) throw new Error('Configure ESPELHO_DATABASE_URL.')
  if (!usuario || !senha) throw new Error('Configure as credenciais Lello do Safira.')
  const destino = new URL(ESPELHO_DATABASE_URL)
  const direto = destino.hostname === 'db.jrctpldzavctwaqiepul.supabase.co'
  const pooler = destino.hostname === 'aws-1-us-east-1.pooler.supabase.com'
    && destino.username.endsWith('.jrctpldzavctwaqiepul')
  if (destino.protocol !== 'postgresql:' || (!direto && !pooler) || destino.search) {
    throw new Error('Informe a URL Postgres do GKLI Espelho sem parâmetros de conexão.')
  }

  const ca = await readFile(new URL('../supabase/prod-ca-2021.crt', import.meta.url), 'utf8')
  const banco = new Client({ connectionString: destino.href, ssl: { ca }, connectionTimeoutMillis: 15000 })
  await banco.connect()
  try {
    const captura = await coletarEspelhoLello({ codigo, nome, usuario, senha }, AbortSignal.timeout(25 * 60_000), console.log)
    await banco.query(
      'insert into public.captacoes (codigo_condominio, condominio, captado_em, dados) values ($1, $2, $3, $4)',
      [codigo, nome, captura.consultadoEm, captura]
    )
    console.log('Espelho atualizado.', {
      unidades: captura.unidades.length, cotasEmAberto: captura.cotas.length,
      acordos: captura.acordos.length, responsaveis: captura.contatos.length,
    })
  } finally {
    await banco.end()
  }
} catch (error) {
  console.error('Captação interrompida:', error.message)
  process.exitCode = 1
}
