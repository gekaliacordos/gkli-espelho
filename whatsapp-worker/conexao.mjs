import { stat } from 'node:fs/promises';
import QRCode from 'qrcode';
import whatsapp from 'whatsapp-web.js';

const {
  WHATSAPP_AUTH_PATH: perfil, WHATSAPP_CHROME: chromium, WHATSAPP_PHONE: numero,
  ESPELHO_URL, ESPELHO_PUBLIC_KEY, WHATSAPP_PILOTO_KEY,
} = process.env;
if (!ESPELHO_URL || !ESPELHO_PUBLIC_KEY || !/^[a-f0-9]{64}$/.test(WHATSAPP_PILOTO_KEY ?? '') || !perfil || !chromium || !/^\d{10,15}$/.test(numero ?? '') || !(await stat(perfil)).isDirectory()) {
  throw new Error('Configure o volume de sessão e o número com DDI antes de iniciar.');
}

const cliente = new whatsapp.Client({
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
    const resposta = await fetch(new URL('/rest/v1/rpc/whatsapp_piloto_publicar', ESPELHO_URL), {
      method: 'POST',
      headers: { apikey: ESPELHO_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: WHATSAPP_PILOTO_KEY, estado, qr }),
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
  console.log('Linha conectada em modo somente conexão.');
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
  console.error('Falha ao iniciar o navegador.', String(erro?.message ?? '').split('\n').filter(linha => !linha.includes('dbus') && !linha.includes('https://')).slice(0, 14).join(' '));
  await encerrar(1);
}
