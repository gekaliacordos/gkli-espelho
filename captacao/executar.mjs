import { Client } from 'pg'
import { coletarEspelhoLello } from './lello.mjs'

const { AGENTE_LELLO_SAFIRA_USUARIO: usuario, AGENTE_LELLO_SAFIRA_SENHA: senha, ESPELHO_DATABASE_URL } = process.env
const codigo = '63004'
const nome = 'Safira'

try {
  if (!ESPELHO_DATABASE_URL) throw new Error('Configure ESPELHO_DATABASE_URL.')
  if (!usuario || !senha) throw new Error('Configure as credenciais Lello do Safira.')
  if (!new URL(ESPELHO_DATABASE_URL).username.endsWith('jrctpldzavctwaqiepul') &&
      new URL(ESPELHO_DATABASE_URL).hostname !== 'db.jrctpldzavctwaqiepul.supabase.co') {
    throw new Error('O banco de destino precisa ser o Supabase do GKLI Espelho.')
  }

  const banco = new Client({ connectionString: ESPELHO_DATABASE_URL, connectionTimeoutMillis: 15000 })
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
