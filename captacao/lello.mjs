import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { autenticarLello } from './lello-auth.mjs'

const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase()

const origem = 'https://portal.lellocondominios.com.br'
const caminhos = {
  atrasos: '/relatorios/CotasInadimplentes.do',
  cotas: '/relatorios/CotasAtrasadas.do',
  historicos: '/relatorios/HistoricoPagamentos.do',
  historico: '/relatorios/HistoricoPagamentosUnidade.do',
  ativos: '/relatorios/AcordosEmAndamento.do',
  acordo: '/relatorios/Acordo.do',
  composicao: '/relatorios/CotasAcordo.do',
  cadastro: '/relatorios/CadastroUnidades.do',
}

function dataBR(valor) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(valor ?? '')) return null
  const iso = valor.split('/').reverse().join('-')
  const data = new Date(`${iso}T12:00:00Z`)
  return Number.isFinite(+data) && data.toISOString().slice(0, 10) === iso ? iso : null
}

function dinheiro(valor) {
  return /^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(valor ?? '') ? Number(valor.replace(/[.,]/g, '')) : null
}

async function ler(frame, ficha = false) {
  return frame.locator('body').evaluate((body, ficha) => {
    const folhas = [...body.querySelectorAll('table')].filter(t => !t.querySelector('table'))
    const tabelas = folhas
      .map(t => [...t.rows].map(r => [...r.cells].map(c => c.innerText.trim())))
    const texto = body.innerText
    return {
    rotulosLinks: [...body.querySelectorAll('a[href], button')].map(a => ({
      rotulo: a.innerText.trim() || a.title || a.getAttribute('aria-label') || a.textContent.trim(),
      caminho: a.tagName === 'A' && a.protocol === location.protocol && a.origin === location.origin ? a.pathname : null,
    })).filter(item => item.rotulo),
    linhasTexto: texto.split('\n').map(linha => linha.trim()).filter(linha =>
      /juros|multa|corre[çc][aã]o|honor[áa]ri|despesas?|descontos?|financeir|composi[çc][aã]o|encargos|negocia|resumo/i.test(linha)),
    pedeLogin: Boolean(body.querySelector('input[type=password]')),
    linhas: tabelas.flat(),
    links: [...body.querySelectorAll('a[href]')].map(a => a.href),
    unidades: [...body.querySelectorAll('input[name="codigoUnidade"]')].map(input => input.value),
    fichas: ficha ? folhas.map(t => Object.fromEntries(
      [...t.querySelectorAll('th')].filter(th => th.nextElementSibling?.tagName === 'TD')
        .map(th => [th.innerText.trim(), th.nextElementSibling.innerText.trim()]))).filter(f => f.Nome) : [],
    semRecibos: /n[aã]o h[aá] recibos para esse condom[ií]nio\/unidade/i.test(texto),
    acordoNaoEncontrado: /^(?:acordo (?:n[a\u00e3]o encontrado|inexistente)|n[a\u00e3]o foi encontrado o acordo)[.!]?$/im.test(texto),
    semAcordos: /n[aã]o (?:h[aá]|existem|foram encontrados)[^\n.]*acordos|nenhum acordo/i.test(texto),
  }}, ficha)
}

export class FalhaTemporariaLello extends Error {}

export async function coletarEtapaLello(etapas, etapa, urls, dependencia, progresso, coletar) {
  const inicio = Date.now()
  const assinatura = createHash('sha256').update(JSON.stringify([dependencia, urls.map(url => url.href).sort()])).digest('hex')
  const anterior = etapas?.salvas.get(etapa)
  if (anterior?.assinatura === assinatura) {
    progresso(`${etapa}: retomada (${Date.now() - inicio} ms)`)
    return anterior.itens
  }
  const itens = await coletar()
  await etapas?.salvar(etapa, { assinatura, itens })
  progresso(`${etapa}: ${Date.now() - inicio} ms`)
  return itens
}

export async function coletarEspelhoLello({ codigo, nome, busca = nome, usuario, senha }, signal, progresso = () => {}, etapas, consultarAcordos) {
  if (!/^\d+$/.test(codigo) || !nome || !usuario || !senha) throw Error('Acesso ou alvo da Lello incompleto.')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const fechar = () => { void browser.close().catch(() => {}) }
  let respostaTemporaria = null
  signal.addEventListener('abort', fechar, { once: true })
  try {
    signal.throwIfAborted()
    const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    context.on('response', res => {
      if (new URL(res.url()).origin === origem && [429, 503].includes(res.status())) {
        respostaTemporaria = res.status()
        fechar()
      }
    })
    const pagina = await context.newPage()
    pagina.setDefaultTimeout(25_000)
    await autenticarLello(pagina, { usuario, senha, signal })
    const botao = pagina.locator('button').filter({ hasText: /^\s*\d+\s*-/ }).filter({ visible: true }).first()
    const padrao = new RegExp(`^\\s*${codigo}\\s*-`)
    if (!padrao.test(await botao.innerText())) {
      await botao.click()
      await pagina.locator('.dropdown.open input[name=search]:visible').first().fill(codigo)
      const buscar = pagina.locator('.dropdown.open').getByText('Buscar', { exact: true }).filter({ visible: true })
      if (await buscar.count()) await buscar.first().click()
      const opcao = pagina.locator('.dropdown.open a').filter({ hasText: padrao }).filter({ visible: true })
      await opcao.click()
      await pagina.waitForFunction(cod => [...document.querySelectorAll('button')].some(b => b.innerText.trim().startsWith(`${cod} -`)), codigo)
    }
    const cabecalho = await botao.innerText()
    if (!padrao.test(cabecalho) || !normalizar(cabecalho).includes(normalizar(busca))) throw Error('Condomínio do portal diverge do cadastro.')
    await context.route('**/*', route => ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue())

    async function menu(pathname) {
      await pagina.locator(`a[href="${pathname}"]`).first().evaluate(a => a.click())
      for (let i = 0; i < 100; i++) {
        signal.throwIfAborted()
        const frame = pagina.frames().find(f => f.url().startsWith(origem + pathname))
        if (frame) {
          await frame.waitForLoadState('domcontentloaded')
          return ler(frame)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      throw Error('Relatório da Lello indisponível.')
    }

    function links(tela, pathname) {
      return [...new Set(tela.links)].map(href => new URL(href)).filter(url => url.pathname === pathname)
    }

    async function visitar(tab, url) {
      if (url.origin !== origem || url.searchParams.get('codCondo') !== codigo) throw Error('Link do portal fora do escopo.')
      let res
      for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
          res = await tab.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25_000 })
          if (res?.status() !== 502 || tentativa === 2) break
        } catch (error) {
          if (respostaTemporaria || signal.aborted || !/Timeout|ERR_(CONNECTION_RESET|TIMED_OUT|EMPTY_RESPONSE)/i.test(error.message)) throw error
          if (tentativa === 2) throw new FalhaTemporariaLello('Falha de conexão durante a consulta da Lello.')
        }
        await new Promise(resolve => setTimeout(resolve, 1200))
        signal.throwIfAborted()
      }
      const atual = new URL(tab.url())
      if (res?.status() === 502) throw new FalhaTemporariaLello('A Lello respondeu HTTP 502 durante a coleta.')
      if (!res?.ok() || atual.origin !== origem || atual.pathname !== url.pathname) {
        throw Error(`Relatório ${url.pathname.split('/').at(-1)} indisponível${res ? ` (HTTP ${res.status()})` : ''}.`)
      }
      const tela = await ler(tab, url.pathname === caminhos.cadastro)
      if (tela.pedeLogin) throw Error('Sessão da Lello expirada durante a coleta.')
      return tela
    }

    async function lote(urls, lerItem, fase) {
      const resultados = []
      let indice = 0
      const tarefas = Array.from({ length: Math.min(3, urls.length) }, async () => {
        const tab = await context.newPage()
        try {
          while (indice < urls.length) {
            signal.throwIfAborted()
            const url = urls[indice++]
            resultados.push(await lerItem(tab, url))
            if (fase && resultados.length % 50 === 0) progresso(`${fase}: ${resultados.length}/${urls.length}`)
          }
        } finally { await tab.close().catch(() => {}) }
      })
      await Promise.all(tarefas)
      if (fase) progresso(`${fase}: ${resultados.length}/${urls.length}`)
      return resultados
    }

    const indiceHistorico = await menu(caminhos.historicos)
    const indiceCotas = await menu(caminhos.atrasos)
    const [linkAtivos] = links(indiceCotas, caminhos.ativos)
    const totalCotas = indiceCotas.linhas.find(r => r[0] === 'TOTAL DE COTAS')?.[1]
    const urlsHistoricos = links(indiceHistorico, caminhos.historico)
    if (!linkAtivos || !/^\d+$/.test(totalCotas ?? '') || !urlsHistoricos.length) throw Error('Índice de cotas, acordos ou pagamentos incompleto.')
    linkAtivos.searchParams.delete('formatoDeExibicao')
    const ativos = (await lote([linkAtivos], visitar))[0]
    const urlsAtivos = links(ativos, caminhos.acordo)
    if (!urlsAtivos.length && !ativos.semAcordos) {
      throw Error('A ausência de acordos ativos não foi confirmada no relatório.')
    }

    if (consultarAcordos) {
      const unidades = new Map(consultarAcordos);
      const referencias = new Map(urlsAtivos.map(url => [url.searchParams.get('codAcordo'), url]));
      const faltam = new Set([...unidades].filter(([numero]) => !referencias.has(numero)).map(([, unidade]) => unidade));
      const historicos = await lote(urlsHistoricos.filter(url => faltam.has(url.searchParams.get('codUnidade'))), visitar);
      for (const tela of historicos) for (const url of links(tela, caminhos.acordo)) {
        const numero = url.searchParams.get('codAcordo');
        if (unidades.has(numero) && !referencias.has(numero)) referencias.set(numero, url);
      }
      const fichas = await lote([...unidades].filter(([numero]) => referencias.has(numero)).map(([numero]) => referencias.get(numero)), async (tab, url) => {
        const numero = url.searchParams.get('codAcordo'), unidade = unidades.get(numero);
        if (url.searchParams.get('codUnidade') !== unidade) return { numero, erro: 'Unidade divergente' };
        url.searchParams.delete('numrecibo');
        url.searchParams.delete('detalheAcordo');
        try {
          const ficha = await visitar(tab, url);
          if (!ficha.linhas.some(r => r[0] === 'Acordo Número' && r[1] === numero) ||
              !ficha.linhas.some(r => r[0] === 'Unidade' && r[1] === unidade)) return { numero, erro: 'Identidade divergente' };
          const comp = links(ficha, caminhos.composicao).find(link =>
            link.searchParams.get('codAcordo') === numero && link.searchParams.get('codUnidade') === unidade);
          const extrair = ({ linhas, rotulosLinks, linhasTexto }) => ({ linhas, rotulosLinks, linhasTexto });
          const composicao = comp ? await visitar(tab, comp) : null;
          const recibos = [];
          for (const link of composicao ? links(composicao, '/relatorios/HistoricoRecibo.do') : []) {
            const parametros = [...link.searchParams.keys()];
            if (link.origin !== origem || link.searchParams.get('codCondo') !== codigo ||
              (link.searchParams.has('codUnidade') && link.searchParams.get('codUnidade') !== unidade)) {
              recibos.push({ erro: 'Histórico sem vínculo de condomínio verificável', parametros });
              continue;
            }
            try { recibos.push(extrair(await visitar(tab, link))); }
            catch { recibos.push({ erro: 'Histórico indisponível', parametros }); }
          }
          return { numero, unidade, ficha: extrair(ficha), composicao: composicao ? extrair(composicao) : null, recibos };
        } catch {
          return { numero, erro: 'Ficha indisponível' };
        }
      });
      return { fichas, ausentes: [...unidades.keys()].filter(numero => !referencias.has(numero)),
        menus: (await ler(pagina)).rotulosLinks.filter(item =>
          /acordo|financ|demonstrativ|posi[çc][aã]o|repasse/i.test(item.rotulo)) };
    }

    const urlsCotas = links(indiceCotas, caminhos.cotas)
    const posicao = [new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), indiceCotas.linhas]
    const formatos = new Map()
    const cotas = await coletarEtapaLello(etapas, 'cotas', urlsCotas, posicao, progresso, async () => {
      const itens = (await lote(urlsCotas, async (tab, url) => {
        const unidade = url.searchParams.get('codUnidade')
        const tela = await visitar(tab, url)
        if (!unidade || !tela.linhas.some(r => r[0] === 'Recibo' && r[1] === 'Vencimento')) throw Error('Ficha de cotas inválida.')
        return tela.linhas.filter(r => /^\d+$/.test(r[0]) && dataBR(r[1])).map(r => {
          const formato = r.slice(2).map(v => dinheiro(v) !== null ? 'V' : v ? 'X' : '_').join('')
          formatos.set(formato, (formatos.get(formato) ?? 0) + 1)
          return { unidade, recibo: r[0], vencimento: dataBR(r[1]), valores: r.slice(2).map(dinheiro) }
        })
      }, 'Cotas')).flat()
      if (itens.length !== Number(totalCotas) || itens.some(c => c.valores.length < 5 || c.valores.some(v => v === null))) {
        progresso('Cotas conferidas: ' + itens.length + '/' + totalCotas + ' · formatos ' + JSON.stringify(Object.fromEntries(formatos)))
        throw Error('Detalhamento de cotas diverge do total da Lello.')
      }
      return itens
    })
    const consultadoEm = new Date().toISOString()

    const historicos = await coletarEtapaLello(etapas, 'historicos', urlsHistoricos, ['historico-por-unidade', posicao, indiceHistorico.linhas], progresso, () => lote(urlsHistoricos, async (tab, url) => {
      const unidade = url.searchParams.get('codUnidade')
      const tela = await visitar(tab, url)
      const unidadeConferida = unidade && tela.unidades.length === 1 && tela.unidades[0] === unidade
      if (tela.semRecibos) return { unidade: unidadeConferida ? unidade : null, pagamentos: [], acordos: [] }
      if (!unidadeConferida) throw Error('Unidade do histórico não confirmada.')
      return {
        unidade,
        pagamentos: tela.linhas.filter(r => /^\d+$/.test(r[0]) && dataBR(r[2])).map(r => ({
          unidade, recibo: r[0], descricao: r[1], vencimento: dataBR(r[2]), situacao: r[3],
          principal: dinheiro(r[4]), pagamento: dataBR(r[5]), valorPago: dinheiro(r[6]),
        })),
        acordos: links(tela, caminhos.acordo).map(link => link.href),
      }
    }, 'Históricos'))

    const referencias = new Map()
    for (const url of [...urlsAtivos, ...historicos.flatMap(h => h.acordos.map(link => new URL(link)))]) {
      const numero = url.searchParams.get('codAcordo')
      const unidade = url.searchParams.get('codUnidade')
      if (!/^\d+$/.test(numero ?? '') || !unidade) throw Error('Identificador de acordo inválido.')
      url.searchParams.delete('numrecibo')
      url.searchParams.delete('detalheAcordo')
      referencias.set(`${unidade}:${numero}`, url)
    }
    const linhasAtivos = ativos.linhas.filter(r => /^\w+\s+-/.test(r[0]) && dataBR(r[1]))
    const datasAtivos = new Map(urlsAtivos.map((url, i) => {
      const unidade = url.searchParams.get('codUnidade')
      return [url.searchParams.get('codAcordo'), linhasAtivos[i]?.[0]?.startsWith(`${unidade} `) ? dataBR(linhasAtivos[i][1]) : null]
    }))
    const urlsAcordos = [...referencias.values()]
    async function lerAcordo(tab, url, consultarAusencia = false) {
      const unidade = url.searchParams.get('codUnidade'), numero = url.searchParams.get('codAcordo')
      const { linhas, ...tela } = await visitar(tab, url)
      if (consultarAusencia && tela.acordoNaoEncontrado && !linhas.some(r => r[0] === 'Acordo Número')) return { naoEncontrado: true }
      const campo = nome => linhas.find(r => r[0] === nome)?.[1]
      const header = linhas.find(r => r[0] === 'Unidade')
      if (campo('Acordo Número') !== numero || header?.[1] !== unidade || !header[2]) throw Error('Identidade do acordo não confirmada.')
      const composicoes = links(tela, caminhos.composicao)
      if (composicoes.length !== 1 || composicoes[0].searchParams.get('codAcordo') !== numero || composicoes[0].searchParams.get('codUnidade') !== unidade) {
        throw Error('A composição do acordo não foi confirmada.')
      }
      const composicao = await visitar(tab, composicoes[0])
      return {
        unidade, numero, situacao: header[2], total: dinheiro(campo('Valor Total:')), pago: dinheiro(campo('Valor Pago:')),
        saldo: dinheiro(campo('Valor Em Aberto:')), data: dataBR(campo('Data Efetivação') ?? campo('Data do Acordo') ?? campo('Data Acordo')) ?? datasAtivos.get(numero) ?? null,
        tipo: campo('Tipo') ?? campo('Tipo Acordo') ?? linhas.find(r => r[0] === 'Nome do Acordo:')?.[2],
        parcelas: linhas.filter(r => r.length === 5 && dataBR(r[0])).map((r, i) => ({
          numero: i + 1, vencimento: dataBR(r[0]), pagamento: dataBR(r[2]), situacao: r[3], valor: dinheiro(r[4]),
        })),
        cotas: composicao.linhas.filter(r => /^\d+$/.test(r[0]) && dataBR(r[1])).map(r => ({
          recibo: r[0], vencimento: dataBR(r[1]), principal: dinheiro(r[2]), situacao: r[4],
        })),
      }
    }
    const acordos = await coletarEtapaLello(etapas, 'acordos', urlsAcordos, [posicao, linhasAtivos], progresso,
      () => lote(urlsAcordos, lerAcordo, 'Acordos'))
    let contatos = []
    let unidades = [...new Set([...urlsHistoricos, ...urlsCotas, ...urlsAcordos].map(url => url.searchParams.get('codUnidade')).filter(Boolean))]
    {
      try {
        const indice = await menu(caminhos.cadastro)
        const urls = links(indice, caminhos.cadastro).filter(url => url.searchParams.get('codUnidade'))
        unidades = [...new Set([...unidades, ...urls.map(url => url.searchParams.get('codUnidade'))])]
        contatos = (await lote(urls, async (tab, url) => {
          try {
            const unidade = url.searchParams.get('codUnidade')
            const tela = await visitar(tab, url)
            const titulares = tela.fichas.filter(f => f.Unidade === unidade && Object.hasOwn(f, 'Email'))
            if (titulares.length !== 1) return null
            const [titular] = titulares
            return { unidade, nome: titular.Nome, email: titular.Email,
              telefones: tela.fichas.filter(f => normalizar(f.Nome) === normalizar(titular.Nome)).flatMap(f => [f.Celular, f.Telefone].filter(Boolean)),
              consultadoEm: new Date().toISOString() }
          } catch (error) {
            if (signal.aborted || respostaTemporaria || error instanceof FalhaTemporariaLello) throw error
            return null
          }
        }, 'Fichas de contato')).filter(Boolean)
      } catch (error) {
        if (signal.aborted || respostaTemporaria || error instanceof FalhaTemporariaLello) throw error
      }
    }
    return { consultadoEm, unidades, cotas, acordos, contatos }
  } catch (error) {
    if (respostaTemporaria) throw new FalhaTemporariaLello(`A Lello respondeu HTTP ${respostaTemporaria} durante a coleta.`)
    throw error
  } finally {
    signal.removeEventListener('abort', fechar)
    await browser.close().catch(() => {})
  }
}
