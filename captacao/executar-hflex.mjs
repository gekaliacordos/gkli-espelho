import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { abrirBanco } from './executar.mjs'
import { baixarRelatoriosHflex } from './hflex.mjs'
import { conciliarHflex } from './conciliar-hflex.mjs'

const alvos = new Map([
  ['hflex', { codigoPortal: '0290', nomePortal: 'COND. ESCRITORIOS RIO NEGRO', nome: 'Escritório Rio Negro', bloco: 'RIO NEGRO' }],
  ['hflex-5987', { codigoPortal: '5987', nomePortal: 'SUBCONDOMINIO EDIFICIO OFFICE TAMBORE', nome: 'Office Tamboré', bloco: 'OFFICE' }],
])
const codigo = process.argv[2] ?? 'hflex'
const alvo = alvos.get(codigo)
if (!alvo) throw Error('Empreendimento HFlex desconhecido.')

const pasta = await mkdtemp(join(tmpdir(), 'gkli-hflex-'))
const caminhos = {
  sintetico: join(pasta, 'acordos.xls'),
  devedores: join(pasta, 'devedores.xls'),
}
let etapa

try {
  await baixarRelatoriosHflex({
    usuario: process.env.ESPELHO_PORTAL_USUARIO,
    senha: process.env.ESPELHO_PORTAL_SENHA,
  }, caminhos, alvo, atual => {
    etapa = atual
    console.info('HFlex · ' + alvo.nome + ' · ' + atual)
  })
  etapa = 'conferência dos relatórios'
  const captadoEm = new Date().toISOString()
  const parser = fileURLToPath(new URL('./hflex-importar.py', import.meta.url))
  const { stdout } = await promisify(execFile)(
    process.env.HFLEX_PYTHON || 'python3',
    [parser, caminhos.sintetico, caminhos.devedores, alvo.bloco],
    { maxBuffer: 16 * 1024 * 1024, timeout: 120_000, env: { ...process.env, PYTHONOPTIMIZE: '' } }
  )
  const arquivos = JSON.parse(stdout)
  let dados
  etapa = 'gravação no Supabase'
  const banco = await abrirBanco(process.env.ESPELHO_DATABASE_URL)
  try {
    await banco.query('begin')
    await banco.query('select pg_advisory_xact_lock(hashtext($1))', [codigo])
    const { rows: [anterior] } = await banco.query(`select captado_em, dados from public.captacoes
      where codigo_condominio = $1 order by captado_em desc limit 1`, [codigo])
    if (anterior && Date.parse(anterior.captado_em) > Date.parse(captadoEm)) {
      throw Error('Já existe uma captação mais recente.')
    }
    dados = conciliarHflex(arquivos, anterior?.dados, captadoEm, alvo.codigoPortal)
    await banco.query(`insert into public.captacoes
      (codigo_condominio, condominio, administradora, captado_em, dados)
      values ($1, $2, $3, $4, $5)`, [codigo, alvo.nome, 'HFlex', captadoEm, dados])
    await banco.query('commit')
  } catch (erro) {
    await banco.query('rollback').catch(() => {})
    throw erro
  } finally {
    await banco.end()
  }
  console.info('HFlex · captação verificada e gravada', {
    condominio: alvo.nome,
    acordos: dados.acordos.length,
    recibosNoRelatorio: dados.cotas.length,
    recibosVinculados: dados.cotasEmAcordoNoRelatorio.length,
    pendentes: dados.cotasConciliacaoPendente.length,
  })
} catch {
  console.error('HFlex · ' + alvo.nome + ' · captação interrompida na etapa de ' + (etapa ?? 'preparação') + '.')
  process.exitCode = 1
} finally {
  await rm(pasta, { recursive: true, force: true })
}
