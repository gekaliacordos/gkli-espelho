import { stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import whatsapp from 'whatsapp-web.js';
import { enviarComRecibo } from './recibo.mjs';

const {
  WHATSAPP_AUTH_PATH: perfil, WHATSAPP_CHROME: chromium, WHATSAPP_PHONE: numero,
  ESPELHO_URL, ESPELHO_PUBLIC_KEY, WHATSAPP_PILOTO_KEY, WHATSAPP_LINHA: linha,
} = process.env;
if ((linha && !['genske', 'escritorio', 'azevedo', 'riseup'].includes(linha)) || !ESPELHO_URL || !ESPELHO_PUBLIC_KEY || !/^[a-f0-9]{64}$/.test(WHATSAPP_PILOTO_KEY ?? '') || !perfil || !chromium || !/^\d{10,15}$/.test(numero ?? '') || !(await stat(perfil)).isDirectory()) {
  throw new Error('Configure o volume de sessão e o número com DDI antes de iniciar.');
}

// O entrypoint mantém um lock exclusivo no volume enquanto o Chromium está aberto.
for (const arquivo of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
  await rm(join(perfil, 'session-espelhar-piloto', arquivo), { force: true });
}

class ClientePareamento extends whatsapp.Client {
  async initWebVersionCache() {
    await super.initWebVersionCache();
    const agente = (await this.pupBrowser.userAgent()).replace('HeadlessChrome/', 'Chrome/');
    await this.pupPage.setUserAgent(agente);
  }


}

const TipoCliente = linha ? ClientePareamento : whatsapp.Client;
const cliente = new TipoCliente({
  ...(linha ? { userAgent: false, authTimeoutMs: 120000, webVersionCache: { type: 'none' } } : {}),
  authStrategy: new whatsapp.LocalAuth({ clientId: 'espelhar-piloto', dataPath: perfil }),
  puppeteer: {
    executablePath: chromium,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
});

let estado = 'iniciando';
let qrAtual = null;
let publicados = Promise.resolve();
function publicar() {
  publicados = publicados.then(async () => {
    const qr = qrAtual && Date.now() - qrAtual.hora < 20000
      ? await QRCode.toDataURL(qrAtual.valor) : null;
    const rpc = linha ? 'whatsapp_piloto_publicar_linha' : 'whatsapp_piloto_publicar';
    const origem = linha ? { linha, numero } : {};
    const resposta = await fetch(new URL('/rest/v1/rpc/' + rpc, ESPELHO_URL), {
      method: 'POST',
      headers: { apikey: ESPELHO_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: WHATSAPP_PILOTO_KEY, estado, qr, ...origem }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) {
      const problema = await resposta.json().catch(() => ({}));
      console.error('Supabase recusou o estado HTTP', resposta.status, /^([0-9A-Z]{5,10})$/.test(problema.code ?? '') ? problema.code : '');
      return;
    }
  }).catch(() => console.error('Falha ao atualizar o estado no Espelhar.'));
  return publicados;
}
function atualizar(proximo, qr = null) {
  estado = proximo;
  qrAtual = qr ? { valor: qr, hora: Date.now() } : null;
  return publicar();
}

let encerrando = false;
async function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  const prazo = setTimeout(() => process.exit(codigo), 8000);
  try { await cliente.destroy(); } catch { /* Chromium pode já estar fechado. */ }
  clearTimeout(prazo);
  process.exit(codigo);
}

async function rpcTeste(funcao, dados = {}) {
  const resposta = await fetch(new URL('/rest/v1/rpc/' + funcao, ESPELHO_URL), {
    method: 'POST',
    headers: { apikey: ESPELHO_PUBLIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave: WHATSAPP_PILOTO_KEY, ...dados }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
  return resposta.json();
}

async function processarTesteAutorizado() {
  if (encerrando || estado !== 'conectado') return;
  try {
    const teste = await rpcTeste('whatsapp_piloto_reservar_teste');
    if (!teste) return;
    let resultado = 'incerto';
    let comprovante = null;
    try {
      const destino = await cliente.getNumberId(teste.numero);
      if (!destino?._serialized) {
        resultado = 'numero_nao_encontrado';
      } else if (!encerrando && estado === 'conectado' && cliente.info?.wid?.user === numero) {
        comprovante = await enviarComRecibo(cliente, destino._serialized, teste.mensagem);
        if (comprovante) resultado = 'enviado';
      }
    } catch {
      // Após a reserva, qualquer erro exige conferência e nunca dispara reenvio automático.
    }
    const salvo = await rpcTeste('whatsapp_piloto_concluir_teste', {
      tarefa: teste.id, resultado, comprovante,
    });
    if (!salvo) throw new Error('Resultado não registrado');
  } catch {
    console.error('Falha ao processar o teste autorizado de WhatsApp.');
  }
}

async function conferirTesteIncerto() {
  if (encerrando || estado !== 'conectado') return;
  try {
    const teste = await rpcTeste('whatsapp_piloto_conferir_teste');
    if (!teste) return;
    const inicio = Math.floor(Date.parse(teste.inicio) / 1000) - 2;
    const fim = Math.ceil(Date.parse(teste.fim) / 1000) + 10;
    const destinos = new Set([`${teste.numero}@c.us`]);
    const numeroLocalizado = await cliente.getNumberId(teste.numero).catch(() => null);
    if (numeroLocalizado?._serialized) destinos.add(numeroLocalizado._serialized);
    const leituras = await Promise.allSettled([...destinos].flatMap(destino => [
      cliente.searchMessages(teste.mensagem, { chatId: destino, limit: 50 }),
      cliente.getChatById(destino).then(chat => chat.fetchMessages({ limit: 50, fromMe: true })),
    ]));
    const resultados = leituras.filter(item => item.status === 'fulfilled' && Array.isArray(item.value));
    const ids = new Set();
    for (const mensagem of resultados.flatMap(item => item.value)) {
      const id = mensagem?.id?._serialized ?? mensagem?.id?.$1;
      if (id?.startsWith('true_') && mensagem.fromMe && destinos.has(mensagem.to) &&
          mensagem.body === teste.mensagem && mensagem.ack >= 1 &&
          mensagem.timestamp >= inicio && mensagem.timestamp <= fim) ids.add(id);
    }
    const resultado = ids.size === 1 ? 'confirmado' : ids.size > 1 ? 'multiplos_recibos'
      : resultados.length ? 'sem_recibo' : 'consulta_indisponivel';
    await rpcTeste('whatsapp_piloto_conferir_teste', {
      tarefa: teste.id, resultado, comprovante: ids.size === 1 ? [...ids][0] : null,
    });
  } catch {
    console.error('Falha ao conferir o recibo do teste de WhatsApp.');
  }
}

cliente.on('qr', qr => void atualizar('aguardando_qr', qr));
cliente.on('authenticated', () => void atualizar('autenticando'));
const heartbeat = setInterval(publicar, 12000);
heartbeat.unref();
cliente.on('ready', () => {
  if (cliente.info?.wid?.user !== numero) {
    console.error('A linha conectada difere da configurada.');
    void atualizar('linha_divergente').then(() => encerrar(1));
    return;
  }
  void atualizar('conectado');
  console.log('Linha conectada para o piloto.');
  if (!linha) void conferirTesteIncerto().then(processarTesteAutorizado);
});
cliente.on('auth_failure', () => {
  console.error('Falha na autenticação da sessão.');
  void atualizar('desconectado').then(() => encerrar(1));
});
cliente.on('disconnected', () => {
  console.error('Sessão desconectada.');
  void atualizar('desconectado').then(() => encerrar(1));
});
process.once('SIGTERM', () => void encerrar(0));
process.once('SIGINT', () => void encerrar(0));

try {
  await publicar();
  await cliente.initialize();
} catch (erro) {
  console.error('Falha ao iniciar o navegador.', String(erro?.message ?? '').split('\n').slice(0, 3).join(' '));
  await encerrar(1);
}
