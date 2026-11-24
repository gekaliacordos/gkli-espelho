import { abrirBanco } from './executar.mjs'
import { gravarAcordosWebware } from './armazenar-webware.mjs'
import { coletarAcordosWebware } from './webware-acordos.mjs'

const portal = process.argv[2]?.toLowerCase()
if (!['atipass', 'villagua'].includes(portal)) {
  console.error('Informe atipass ou villagua.')
  process.exitCode = 1
} else {
  try {
    const acordos = await coletarAcordosWebware(portal, {
      usuario: process.env.ESPELHO_PORTAL_USUARIO,
      senha: process.env.ESPELHO_PORTAL_SENHA,
    })
    const banco = await abrirBanco(process.env.ESPELHO_DATABASE_URL)
    try {
      const quantidade = await gravarAcordosWebware(banco, portal, acordos, new Date().toISOString())
      console.log(portal + ' · acordos conferidos e gravados:', quantidade)
    } finally {
      await banco.end()
    }
  } catch {
    console.error(portal + ' · a grade requer revisão; os acordos anteriores foram preservados.')
    process.exitCode = 1
  }
}
