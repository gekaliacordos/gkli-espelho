import { appendFile } from 'node:fs/promises'
import { abrirBanco } from './executar.mjs'

const banco = await abrirBanco(process.env.ESPELHO_DATABASE_URL)
let rows
try {
  ({ rows } = await banco.query('select portal, codigo from public.espelhamento_pendentes()'))
} finally {
  await banco.end()
}
const grupos = new Map()
for (const { portal, codigo } of rows) {
  if (!/^[a-z]+$/.test(portal) || !/^[a-z0-9-]+$/.test(codigo)) throw Error('Alvo da agenda inválido.')
  grupos.set(portal, [...(grupos.get(portal) ?? []), codigo])
}
const hflex = grupos.get('hflex') ?? []
grupos.delete('hflex')
const alvos = [...grupos].map(([portal, codigos]) => ({ portal, codigos: codigos.join(',') }))
console.info(rows.length + ' captações elegíveis para o ciclo.')
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    'alvos=' + JSON.stringify(alvos),
    'hflex=' + hflex.join(','),
    'tem_alvos=' + Boolean(alvos.length),
    '',
  ].join('\n'))
}
