import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { coletarEspelhoLello } from './lello.mjs';
import { alvosLello } from './alvos-lello.mjs';
import { abrirBanco } from './executar.mjs';

const origem = 'https://portal.lellocondominios.com.br';
const buscaPath = '/acob/buscaAcordo.jsp';
const acao = '/acob/servlet/BuscaAcordo';
const alvo = alvosLello.find(item => item.codigo === process.argv[2]);
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
const campos = {
  original: 'valor original', juros: 'valor juros', multa: 'valor multa', custas: 'valor custas',
  despesas: 'valor despesas', jurosParcelas: 'valor juros parcelas', desconto: 'valor desconto',
  total: 'valor total do acordo', pago: 'valor parcelas pagas', correcao: 'valor correcao monetaria',
  honorarios: 'valor honorarios',
};
const dinheiro = valor => /^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(valor ?? '') ? Number(valor.replace(/[.,]/g, '')) : null;

function lerFicha(payload, acordo) {
  const { linhas, texto } = payload;
  const camposFicha = new Map(linhas.flatMap(row => row.flatMap((x, i) => {
    const campo = normalizar(x).replace(/\s*\([+−-]\)$/, '').trim();
    return i % 2 === 0 && row[i + 1] ? [[campo, row[i + 1]]] : [];
  })));
  if (/login expirou|sess[aã]o expirad/i.test(texto)) return { erro: 'Sessão Acob expirada', transitorio: true };
  if (/nenhum resultado encontrado/i.test(texto)) return { erro: 'Acordo não encontrado no Acob' };
  const codigo = camposFicha.get('referencia')?.match(/^\s*0*(\d+)\b/)?.[1];
  const unidade = camposFicha.get('codigo unidade')?.split(/\s+-\s+/)[0].trim();
  if (codigo !== alvo.codigo || unidade !== acordo.unidade || camposFicha.get('codigo acordo') !== acordo.numero) {
    return { erro: 'Identidade do acordo não confirmada' };
  }
  const valores = Object.fromEntries(Object.entries(campos).map(([chave, rotulo]) => [chave, dinheiro(camposFicha.get(rotulo))]));
  if (valores.original === null || valores.total === null) return { erro: 'Campos financeiros incompletos' };
  return { ...valores, status: camposFicha.get('status') ?? null, data: camposFicha.get('data criacao') ?? null,
    diferenca: valores.total - ((valores.original ?? 0) + (valores.juros ?? 0) + (valores.multa ?? 0) +
      (valores.custas ?? 0) + (valores.despesas ?? 0) + (valores.jurosParcelas ?? 0) +
      (valores.correcao ?? 0) + (valores.honorarios ?? 0) - (valores.desconto ?? 0)) };
}

function extrair(body) {
  return { texto: body.innerText?.trim().slice(0, 1000) ?? body.textContent?.trim().slice(0, 1000) ?? '',
    linhas: [...body.querySelectorAll('table')].filter(t => !t.querySelector('table'))
      .flatMap(t => [...t.rows].map(r => [...r.cells].map(c => c.textContent.trim()))) };
}

async function coletar(pagina, contexto, acordos) {
  const popup = contexto.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  let abriu = false;
  for (let i = 0; i < 25 && !abriu; i++) {
    abriu = await pagina.locator('a[href]').evaluateAll((ancoras, portal) => {
      const a = ancoras.find(el => el.origin === portal && /^\/acob\/?$/i.test(el.pathname));
      if (!a) return false;
      a.click();
      return true;
    }, origem).catch(() => false);
    if (!abriu) await pausa(300);
  }
  if (!abriu) throw Error('Menu Acob indisponível');
  const acob = await popup ?? pagina;
  await acob.waitForLoadState('domcontentloaded', { timeout: 18000 }).catch(() => {});
  let perfil = false;
  for (let i = 0; i < 30 && !perfil; i++) {
    for (const frame of acob.frames()) {
      if (!frame.url().startsWith(origem + '/acob')) continue;
      const acesso = frame.getByText(/^Acesso\s+COJUR$/i, { exact: true });
      if (await acesso.count() !== 1) continue;
      await acesso.evaluate(el => el.click());
      perfil = true;
      break;
    }
    if (!perfil) await pausa(300);
  }
  async function abrirBusca() {
    for (let i = 0; i < 40; i++) {
      const nav = acob.frames().find(frame => frame.url().startsWith(origem + '/acob/NAV.jsp'));
      const busca = nav?.getByText(/^Busca Acordos$/i, { exact: true });
      if (await busca?.count() === 1) {
        await busca.evaluate(el => el.click());
        for (let j = 0; j < 40; j++) {
          const frame = acob.frames().find(f => f.url().startsWith(origem + buscaPath));
          if (frame) return frame;
          await pausa(250);
        }
      }
      await pausa(300);
    }
    throw Error('Busca do Acob indisponível');
  }

  let modelo;
  async function buscaTela(acordo) {
    const frame = await abrirBusca();
    const form = frame.locator('form[action$="/BuscaAcordo"]');
    await form.locator('select[name=esc_empresa] option').first().waitFor({ state: 'attached', timeout: 20000 });
    await form.locator('select[name=esc_empresa]').selectOption({ label: 'LELLO CONDOMINIOS LTDA' });
    await form.locator('input[name=pre_codigo]').fill(alvo.codigo);
    await form.locator('input[name=aco_recNum]').fill(acordo.numero);
    await form.locator('input[name=aco_dt_cria1]').fill('');
    await form.locator('input[name=aco_dt_cria2]').fill('');
    const responder = contexto.waitForEvent('request', {
      predicate: req => new URL(req.url()).origin === origem && new URL(req.url()).pathname === acao,
      timeout: 25000,
    }).catch(() => null);
    await Promise.all([
      frame.waitForURL(url => url.origin === origem && url.pathname === acao, { waitUntil: 'domcontentloaded', timeout: 25000 }),
      form.getByRole('button', { name: 'Buscar', exact: true }).click(),
    ]);
    const req = await responder;
    if (req) {
      const url = new URL(req.url());
      const params = req.method() === 'POST' ? new URLSearchParams(req.postData() ?? '') : url.searchParams;
      if (params.get('aco_recNum') === acordo.numero && params.get('pre_codigo') === alvo.codigo &&
        (req.method() === 'GET' || (req.method() === 'POST' && /application\/x-www-form-urlencoded/i.test(req.headers()['content-type'] ?? '')))) {
        modelo = { method: req.method(), params: params.toString() };
      }
    }
    return lerFicha(await frame.locator('body').evaluate(extrair), acordo);
  }

  let paginaParser;
  async function buscaRapida(acordo) {
    const parametros = new URLSearchParams(modelo.params);
    parametros.set('aco_recNum', acordo.numero);
    const url = new URL(acao, origem);
    const opcoes = { method: modelo.method, timeout: 22000, maxRedirects: 0 };
    if (modelo.method === 'POST') {
      opcoes.data = parametros.toString();
      opcoes.headers = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: origem + buscaPath };
    } else {
      url.search = parametros.toString();
    }
    const resposta = await contexto.request.fetch(url.href, opcoes);
    try {
      if (!resposta.ok()) return { erro: 'Consulta Acob indisponível', transitorio: true };
      const html = await resposta.text();
      if (!paginaParser) paginaParser = await contexto.newPage();
      const conteudo = await paginaParser.evaluate(({ html, extrator }) => {
        const body = new DOMParser().parseFromString(html, 'text/html').body;
        // Repete a mesma leitura da ficha, com o HTML fora do DOM da página.
        return { texto: body.textContent.trim().slice(0, 2000),
          linhas: [...body.querySelectorAll('table')].filter(t => !t.querySelector('table'))
            .flatMap(t => [...t.rows].map(r => [...r.cells].map(c => c.textContent.trim()))) };
      }, { html });
      return lerFicha(conteudo, acordo);
    } finally { await resposta.dispose(); }
  }

  const fichas = [];
  for (const [indice, acordo] of acordos.entries()) {
    let ficha;
    if (modelo) {
      ficha = await buscaRapida(acordo).catch(() => ({ erro: 'Consulta Acob indisponível', transitorio: true }));
    }
    if (!ficha || ficha.transitorio || ficha.erro === 'Identidade do acordo não confirmada') {
      ficha = await buscaTela(acordo).catch(() => ({ erro: 'Ficha do Acob indisponível' }));
    }
    fichas.push({ ...acordo, ...ficha });
    if ((indice + 1) % 10 === 0) console.log('Consultas concluídas:', indice + 1);
    await pausa(250);
  }
  return fichas;
}

async function alvosAtivos() {
  const db = await abrirBanco(process.env.ESPELHO_DATABASE_URL);
  try {
    const r = await db.query(`
      with recente as (
        select dados, captado_em from public.captacoes
        where codigo_condominio=$1 and administradora_chave='lello' order by captado_em desc,id desc limit 1
      ), base as (
        select a, ord, captado_em,
          translate(lower(trim(coalesce(a->>'situacao',a->>'status',''))),'áàãâéêíóôõúüç','aaaaeeiooouuc') s,
          case when jsonb_typeof(a->'saldo')='number' then (a->>'saldo')::numeric end saldo
        from recente cross join lateral jsonb_array_elements(coalesce(dados->'acordos','[]')) with ordinality v(a,ord)
      )
      select distinct on(a->>'unidade',a->>'numero') a->>'numero' numero,a->>'unidade' unidade,
        a->>'situacao' statusEspelho, captado_em
      from base where coalesce(a->>'unidade','')<>'' and a->>'numero' ~ '^[0-9]+$' and a->>'numero'<>'0'
        and s !~ 'quitad|cancelad|encerrad|rompid|quebrad|liquidad|rescindid|renegociad|inativ|acordo pago'
        and (saldo>0 or ((saldo is null or saldo<0) and s ~ 'ativ|andamento|vigent|abert|atras|pendente|efetivad|firmad'))
      order by a->>'unidade',a->>'numero',ord desc
    `, [alvo.codigo]);
    return r.rows;
  } finally { await db.end(); }
}

function publicar(payload) {
  const chave = randomBytes(32), iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(gzipSync(JSON.stringify(payload))), cifra.final()]);
  const envelope = Buffer.concat([publicEncrypt({ key: Buffer.from(process.env.PUBLIC_RESULT_KEY, 'base64'),
    padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, chave), iv, cifra.getAuthTag(), dados]).toString('base64');
  for (let i = 0; i < envelope.length; i += 2000) console.log('LELLO_FIN_' + (i / 2000) + '=' + envelope.slice(i, i + 2000));
}

try {
  if (!alvo) throw Error('Alvo indisponível');
  const acordos = await alvosAtivos();
  console.log('Acordos selecionados:', acordos.length);
  const perfil = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64, 'base64')).lello[alvo.perfil];
  let fichas;
  try {
    fichas = acordos.length ? await coletarEspelhoLello({ ...alvo, ...perfil }, AbortSignal.timeout(19 * 60000),
      () => {}, undefined, (pagina, contexto) => coletar(pagina, contexto, acordos)) : [];
  } catch (error) {
    fichas = acordos.map(acordo => ({ ...acordo, erro: /^(?:Menu Acob indisponível|Busca do Acob indisponível|SCANNER_AUTH_RECUSADA|SCANNER_AUTH_TRANSITORIA)$/.test(error?.code ?? error?.message)
      ? error.code ?? error.message : 'Acesso ao Acob indisponível' }));
  }
  publicar({ codigo: alvo.codigo, condominio: alvo.nome, fichas });
  console.log('Fichas confirmadas:', fichas.filter(f => !f.erro).length, 'de', acordos.length);
} catch {
  console.error('Não foi possível concluir a consulta pontual.');
  process.exitCode = 1;
}
