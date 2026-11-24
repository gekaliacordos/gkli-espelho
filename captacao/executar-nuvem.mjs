import { abrirBanco, executarAlvos } from './executar.mjs'
import { alvosLello } from './alvos-lello.mjs'
import { coletarWebware } from './webware.mjs'
import { coletarAcordosWebware } from './webware-acordos.mjs'
import { coletarWebwareNuvem } from './webware-nuvem.mjs'
import { coletarManager } from './manager.mjs'
import { coletarHabitacional } from './habitacional.mjs'
import { coletarOma } from './oma.mjs'

const [portal, alvo] = process.argv.slice(2)
const nomes = { lello: 'Lello', bbz: 'BBZ', manager: 'Manager', graiche: 'Graiche', habitacional: 'Habitacional', oma: 'OMA',
  atipass: 'Atipass', villagua: 'Villágua' }
let falhas = 0
let visitados = 0
let banco

async function gravar(codigo, nome, cotas, acordos) {
  if (!cotas && !Array.isArray(acordos)) return
  const hora = new Date().toISOString()
  await banco.query('begin')
  try {
    await banco.query('select pg_advisory_xact_lock(hashtext($1))', [codigo])
    const { rows: [anterior] } = await banco.query(
      'select condominio, dados from public.captacoes where codigo_condominio = $1 order by captado_em desc limit 1', [codigo])
    const antes = anterior?.dados ?? {}
    const { acordos: ignorarAcordos, unidades: unidadesCotas, contatos, ...dadosCotas } = cotas ?? {}
    const recibos = dadosCotas.cotas ?? antes.cotas ?? []
    const novosAcordos = acordos ?? antes.acordos ?? []
    const dados = {
      ...antes, ...dadosCotas, cotas: recibos,
      unidades: [...new Set([...(unidadesCotas ?? antes.unidades ?? []), ...novosAcordos.map(a => a.unidade)])],
      contatos: contatos ?? antes.contatos ?? [],
      totalCotas: recibos.reduce((s, cota) => s + cota.valores.at(-1), 0),
      acordos: novosAcordos.map(a => {
        if (!a.periodoNegociado || !(a.saldo > 0)) return a
        const { inicio, fim } = a.periodoNegociado
        return { ...a, cotasAbertasNoPeriodo: recibos.filter(c => c.unidade === a.unidade && c.vencimento >= inicio && c.vencimento <= fim)
          .map(({ recibo, vencimento }) => ({ recibo, vencimento })) }
      }),
      cotasCaptadasEm: cotas ? hora : antes.cotasCaptadasEm,
      acordosCaptadosEm: acordos ? hora : antes.acordosCaptadosEm,
      cobertura: [
        cotas ? 'Relatório de cotas atualizado.' : 'Relatório de cotas pendente nesta execução.',
        acordos ? 'Grade de acordos atualizada.' : 'Grade de acordos pendente nesta execução.',
        portal === 'habitacional' ? 'Recibos negociados e referências de garantidora conciliados quando ambos os relatórios estão disponíveis.'
          : 'Coincidências de unidade e período indicam recibos para revisão.',
      ].join(' '),
    }
    await banco.query('insert into public.captacoes (codigo_condominio, condominio, administradora, captado_em, dados) values ($1,$2,$3,$4,$5)',
      [codigo, anterior?.condominio ?? nome, nomes[portal], hora, dados])
    await banco.query('commit')
    console.info(codigo, 'gravado', { cotas: cotas ? recibos.length : null, acordos: acordos?.length ?? null })
  } catch (erro) {
    await banco.query('rollback').catch(() => {})
    throw erro
  }
}

async function visitar(codigo, nome, coletar) {
  if (alvo && codigo !== alvo) return
  visitados++
  const etapa = async (nomeEtapa, fazer) => {
    try {
      return await fazer()
    } catch (erro) {
      falhas++
      console.error(codigo, nomeEtapa, erro.name === 'TimeoutError' ? 'tempo esgotado' : 'validação ou consulta falhou')
      return undefined
    }
  }
  await etapa('captação ou gravação', async () => {
    const { cotas, acordos } = await coletar(etapa)
    await gravar(codigo, nome, cotas, acordos)
  })
}

try {
  if (!nomes[portal]) throw Error('Portal desconhecido.')
  const credenciais = JSON.parse(process.env.ESPELHO_PORTAL_CONFIG || '{}') ?? {}
  const url = process.env.ESPELHO_DATABASE_URL
  if (!url) throw Error('Conexão ausente.')
  if (portal === 'lello') {
    const alvos = alvosLello.filter(a => !alvo || a.codigo === alvo)
    if (!alvos.length) throw Error('Alvo ausente.')
    for (const a of alvos) {
      const perfil = credenciais[a.perfil]
      if (!perfil?.usuario || !perfil?.senha) { falhas++; console.error(a.codigo, 'credencial indisponível'); continue }
      const prefixo = a.perfil === 'PADRAO' ? 'AGENTE_LELLO' : 'AGENTE_LELLO_' + a.perfil
      falhas += await executarAlvos([a], { ESPELHO_DATABASE_URL: url, [prefixo + '_USUARIO']: perfil.usuario, [prefixo + '_SENHA']: perfil.senha })
    }
  } else {
    if (!credenciais.usuario || !credenciais.senha) throw Error('Credencial ausente.')
    banco = await abrirBanco(url)
    if (portal === 'manager') await coletarManager(credenciais, visitar)
    else if (portal === 'habitacional') await coletarHabitacional(credenciais, visitar)
    else if (portal === 'oma') await coletarOma(credenciais, visitar)
    else if (['bbz', 'graiche'].includes(portal)) await coletarWebwareNuvem(portal, credenciais, visitar)
    else {
      const atipass = portal === 'atipass'
      await visitar(portal, atipass ? 'Residencial das Ilhas' : 'Square Guarulhos', async etapa => {
        const cotas = await etapa('cotas', () => coletarWebware(portal, credenciais))
        const acordos = await etapa('acordos', () => coletarAcordosWebware(portal, credenciais))
        return { cotas, acordos }
      })
    }
    if (!visitados) throw Error('Alvo ausente.')
  }
} catch {
  falhas++
  console.error(portal ?? 'portal', 'falha na configuração ou autenticação')
} finally {
  await banco?.end()
}
process.exitCode = falhas ? 1 : 0
