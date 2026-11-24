const entidades = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

function texto(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (original, codigo) => {
      if (codigo[0] !== '#') return entidades[codigo.toLowerCase()] ?? original
      const hexadecimal = codigo[1].toLowerCase() === 'x'
      const ponto = Number.parseInt(codigo.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return ponto <= 0x10ffff ? String.fromCodePoint(ponto) : original
    }).replace(/\s+/g, ' ').trim()
}

export function centavos(valor) {
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(valor ?? '')) {
    throw new Error('Valor monetário inválido no relatório CondoPro.')
  }
  return Number(valor.replace(/[.,]/g, ''))
}

export function dataIso(valor) {
  const iso = valor.split('/').reverse().join('-')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || new Date(iso).toISOString().slice(0, 10) !== iso) {
    throw new Error('Vencimento inválido no relatório CondoPro.')
  }
  return iso
}

export function lerInadimplenciaCondoPro(buffer, identidade) {
  const charset = /charset\s*=\s*["']?utf-8/i.test(buffer.subarray(0, 1000).toString())
    ? 'utf-8' : 'windows-1252'
  const documento = new TextDecoder(charset).decode(buffer)
  const normalizar = valor => valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
  const linhas = [...documento.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, linha]) => [...linha.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, celula]) => texto(celula)))
  if (!linhas.slice(0, 12).some(linha => normalizar(linha.join(' ')).includes(normalizar(identidade)))) {
    throw new Error('Relatório CondoPro não identifica o condomínio esperado.')
  }

  const cotas = []
  const contatos = new Map()
  const recibos = new Set()
  let unidade, totalUnidade = 0, totalDeclarado, totalGeral, reciboPendente
  function conferirUnidade() {
    if (reciboPendente || (unidade && totalUnidade !== totalDeclarado)) {
      throw new Error('Total da unidade diverge dos recibos CondoPro.')
    }
  }
  function adicionar(recibo, vencimento, valores) {
    const chave = unidade + ':' + recibo
    if (!/^\d+$/.test(recibo) || recibos.has(chave)) throw new Error('Identidade de recibo CondoPro inválida ou repetida.')
    recibos.add(chave)
    cotas.push({ unidade, recibo, vencimento: dataIso(vencimento), valores })
    totalUnidade += valores.at(-1)
  }

  for (const linha of linhas) {
    const rotulo = linha.join(' ')
    const blocoUnidade = rotulo.match(/^Bloco:\s*(\S+)\s+Unidade:\s*(\S+)\s*(.*)$/i)
    if (blocoUnidade) {
      conferirUnidade()
      const [, bloco, numero, nome] = blocoUnidade
      unidade = bloco + '/' + numero
      totalUnidade = 0
      totalDeclarado = undefined
      if (nome) contatos.set(unidade, { unidade, nome })
      continue
    }
    const indiceGeral = linha.findIndex(valor => /^Total do condom[ií]nio/i.test(valor))
    if (indiceGeral >= 0) {
      totalGeral = centavos(linha.at(-1))
      continue
    }
    if (!unidade) continue
    if (/^Total Geral da Unidade/i.test(linha[0])) {
      totalDeclarado = centavos(linha.at(-1))
      continue
    }
    if (/^Total do Recibo/i.test(linha[0])) {
      if (!reciboPendente) throw new Error('Subtotal CondoPro sem recibo.')
      const valores = linha.slice(-5).map(centavos)
      adicionar(reciboPendente.recibo, reciboPendente.vencimento, valores)
      reciboPendente = undefined
      continue
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(linha[1])) continue
    const recibo = linha[0].replace(/^\D+/, '').trim()
    if (linha.length === 12) {
      if (reciboPendente) throw new Error('Recibo CondoPro sem subtotal.')
      reciboPendente = { recibo, vencimento: linha[1] }
    } else if (linha.length === 8 && linha[6]) {
      adicionar(recibo, linha[1], [centavos(linha[6])])
      if (linha[7]) totalDeclarado = centavos(linha[7])
    }
  }
  conferirUnidade()
  if (!cotas.length || cotas.reduce((total, cota) => total + cota.valores.at(-1), 0) !== totalGeral) {
    throw new Error('Total geral do relatório CondoPro ausente ou divergente.')
  }
  return {
    unidades: [...new Set(cotas.map(cota => cota.unidade))],
    cotas,
    contatos: [...contatos.values()],
    acordos: [],
    cobertura: 'Relatório de cotas abertas. As unidades listadas são as que aparecem no relatório; cadastro integral, responsáveis e acordos ainda não foram conferidos.',
  }
}
