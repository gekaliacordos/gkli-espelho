import { abrirBanco } from './executar.mjs'
import { gravarCotasWebware } from './armazenar-webware.mjs'
import { coletarWebware, configuracoesWebware } from './webware.mjs'

const portal = process.argv[2]?.toLowerCase()
const config = configuracoesWebware[portal]
if (!config) {
  console.error('Informe um portal Webware configurado: atipass, villagua ou sell.')
  process.exitCode = 1
} else {
  try {
    const dados = await coletarWebware(portal, {
      usuario: process.env.ESPELHO_PORTAL_USUARIO,
      senha: process.env.ESPELHO_PORTAL_SENHA,
    })
    const banco = await abrirBanco(process.env.ESPELHO_DATABASE_URL)
    try {
      await gravarCotasWebware(banco, portal, config, dados)
    } finally {
      await banco.end()
    }
    console.log(config.nome + ' · captação gravada', {
      unidades: dados.unidades.length,
      cotasEmAberto: dados.cotas.length,
    })
  } catch {
    console.error(config.nome + ' · a captação requer revisão do acesso ou do relatório.')
    process.exitCode = 1
  }
}
