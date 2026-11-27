import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { coletarManager, alvosManager } from './manager.mjs';

const dataInicial = '2026-11-11';
const dataFinal = '2026-11-27';
const codigos = new Set(process.argv[2].split(','));
const origem = 'https://atentum-s9.webware.com.br';
const alvos = new Set(alvosManager.map(a => a.codigo));
if (!codigos.size || [...codigos].some(c => !alvos.has(c))) throw Error('Escopo da consulta inválido.');

async function lerMenu(pagina, menu) {
  const opcoes = await menu.locator('select[name=Conteudo] option').evaluateAll(opcoes =>
    opcoes.map(x => x.textContent.trim()).filter(Boolean));
  const links = await Promise.all(pagina.frames().filter(f => f.url().startsWith(origem + '/')).map(f =>
    f.locator('a[href]').evaluateAll(links => links.map(a => ({
      nome: (a.innerText || a.title || a.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ').slice(0,100),
      caminho: a.origin === location.origin ? a.pathname : null,
    })).filter(l => /repasse|relat[oó]rio|acordo|baixa|recebimento|despesa|extrato|prest[a-zçã]+ de conta|demonstrativo|honor[aá]rio/i.test(l.nome))
    ).catch(()=>[])));
  return { opcoes, links:links.flat() };
}

async function lerGrade(frame) {
  return frame.locator('body').evaluate(body => {
    const tabela = body.querySelector('#tableAcordo');
    const cabecalho = tabela ? [...tabela.rows].find(r => /Bloco[\s\S]*Unidade[\s\S]*Processo/.test(r.innerText)) : null;
    return { campos: cabecalho ? [...cabecalho.cells].map(c => c.innerText.trim()) : [],
      acoes: [...body.querySelectorAll('a[href],button,input[type=button],input[type=submit]')].map(el => ({
        nome: (el.innerText || el.title || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ').slice(0,100),
        caminho: el.origin === location.origin ? el.pathname : null,
        naGrade: !!el.closest('#tableAcordo'),
      })).filter(l => l.naGrade || /repasse|despesa|extrato|demonstrativo|honor[aá]rio|export|arquivo|impr/i.test(l.nome)).slice(0,50),
      financeiro: /valor (?:do |de )?(?:repasse|despesas|honor[aá]rios)|repasse da parcela/i.test(tabela?.innerText ?? ''),
    };
  });
}

function publicar(dados) {
  const chave = randomBytes(32);
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const payload = Buffer.concat([cifra.update(gzipSync(JSON.stringify(dados))), cifra.final()]);
  const envelope = Buffer.concat([publicEncrypt({key:Buffer.from(process.env.PUBLIC_RESULT_KEY,'base64'),
    padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},chave),iv,cifra.getAuthTag(),payload]).toString('base64');
  for (let i=0;i<envelope.length;i+=1800) console.log('MANAGER_FIN_'+(i/1800)+'='+envelope.slice(i,i+1800));
}

try {
  const credenciais = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64,'base64')).manager;
  const relatorios = [];
  await coletarManager(credenciais, async (codigo, nome, executar) => {
    try {
      const { acordos, menus } = await executar((_etapa, operacao) => operacao());
      relatorios.push({ codigo, nome, ativos: acordos.filter(a => a.saldo > 0).length, menus,
        pagamentos: acordos.filter(a => a.saldo > 0).flatMap(({ unidade, numero, parcelas }) =>
          parcelas.filter(p => p.pagamento >= dataInicial && p.pagamento <= dataFinal)
            .map(p => ({ unidade, acordo: numero, ...p }))),
      });
      console.log('Grade consultada.');
    } catch {
      relatorios.push({ codigo, nome, erro: 'Consulta da grade indisponível' });
      console.log('Grade indisponível em um alvo.');
    }
  }, { codigos, lerMenu, lerGrade });
  publicar(relatorios);
  console.log('Consulta encerrada.');
} catch {
  console.log('Acesso da Manager indisponível.');
  process.exitCode = 1;
}
