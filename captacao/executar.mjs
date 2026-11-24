import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { alvosLello } from './alvos-lello.mjs'
import { coletarEspelhoLello } from './lello.mjs'

async function abrirBanco(url) {
  const destino = new URL(url)
  const direto = destino.hostname === 'db.jrctpldzavctwaqiepul.supabase.co'
  const pooler = destino.hostname === 'aws-1-us-east-1.pooler.supabase.com'
    && destino.username.endsWith('.jrctpldzavctwaqiepul')
  if (destino.protocol !== 'postgresql:' || (!direto && !pooler) || destino.search) {
    throw new Error('Informe a URL Postgres do GKLI Espelho sem parâmetros de conexão.')
  }
  const ca = await readFile(new URL('../supabase/prod-ca-2021.crt', import.meta.url), 'utf8')
  const banco = new Client({ connectionString: destino.href, ssl: { ca }, connectionTimeoutMillis: 15000 })
  await banco.connect()
  return banco
}

export async function executarAlvos(alvos, env, log = console.log) {
  const banco = await abrirBanco(env.ESPELHO_DATABASE_URL)
  let falhas = 0
  try {
    for (const alvo of alvos) {
      const prefixo = alvo.perfil === 'PADRAO' ? 'AGENTE_LELLO' : 'AGENTE_LELLO_' + alvo.perfil
      const credenciais = { usuario: env[prefixo + '_USUARIO'], senha: env[prefixo + '_SENHA'] }
      let etapa = 'configuração'
      try {
        if (!credenciais.usuario || !credenciais.senha) throw new Error('Credencial ausente.')
        log(alvo.nome + ' · iniciando')
        const { codigo } = alvo
        etapa = 'consulta'
        const captura = await coletarEspelhoLello({ ...alvo, codigo, ...credenciais },
          AbortSignal.timeout(25 * 60_000), mensagem => log(alvo.nome + ' · ' + mensagem))
        etapa = 'gravação'
        await banco.query(
          'insert into public.captacoes (codigo_condominio, condominio, captado_em, dados) values ($1, $2, $3, $4)',
          [codigo, alvo.nome, captura.consultadoEm, captura]
        )
        log(alvo.nome + ' · atualizado', {
          codigo, unidades: captura.unidades.length, cotasEmAberto: captura.cotas.length,
          acordos: captura.acordos.length, responsaveis: captura.contatos.length,
        })
      } catch (erro) {
        falhas++
        const motivo = erro.code === 'SCANNER_AUTH_RECUSADA' ? 'Acesso recusado ou exige verificação humana.'
          : erro.constructor.name === 'FalhaTemporariaLello' ? 'Portal temporariamente indisponível.'
          : 'Confira o portal e a configuração.'
        log(alvo.nome + ' · falhou na ' + etapa + '. ' + motivo)
        if (erro.constructor.name === 'FalhaTemporariaLello') break
      }
    }
  } finally {
    await banco.end()
  }
  return falhas
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const nomes = process.argv.slice(2)
  const alvos = nomes.length ? nomes.map(nome => alvosLello.find(alvo => alvo.nome === nome)) : [alvosLello[0]]
  if (alvos.some(alvo => !alvo)) {
    console.error('Use o nome de um condomínio cadastrado no captador.')
    process.exitCode = 1
  } else {
    try {
      process.exitCode = (await executarAlvos(alvos, process.env)) ? 1 : 0
    } catch {
      console.error('Falha de conexão ou configuração do Supabase do espelho.')
      process.exitCode = 1
    }
  }
}
