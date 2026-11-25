import { setTimeout as esperar } from 'node:timers/promises';

export function idRecibo(mensagem) {
  const id = mensagem?.id?._serialized ?? mensagem?.id?.$1;
  return typeof id === 'string' && id.startsWith('true_') ? id : null;
}

async function comPrazo(consulta, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(consulta),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enviarComRecibo(cliente, destino, texto, {
  tentativas = 8, intervalo = 1500, prazoLeitura = 3000, prazoEnvio = 25000,
} = {}) {
  const chat = await comPrazo(() => cliente.getChatById(destino), prazoLeitura);
  const destinos = new Set([destino, chat?.id?._serialized].filter(Boolean));
  const fontes = [
    () => cliente.searchMessages(texto, { chatId: destino, limit: 50 }),
    ...(chat ? [() => chat.fetchMessages({ limit: 50, fromMe: true })] : []),
  ];
  const linhasDeBase = await Promise.all(fontes.map(fonte => comPrazo(fonte, prazoLeitura)));
  const existentes = new Set(linhasDeBase.filter(Array.isArray).flat().map(idRecibo));
  const inicio = Math.floor(Date.now() / 1000);
  const recibos = new Set();
  let idDireto;
  function observar(mensagem, ack = mensagem?.ack) {
    const id = idRecibo(mensagem);
    const remoto = mensagem?.id?.remote;
    const correspondeAoDestino = [mensagem?.to, remoto?._serialized ?? remoto].some(valor => destinos.has(valor));
    if (id && ack >= 1 && (id === idDireto || (
      mensagem.fromMe && correspondeAoDestino && mensagem.body === texto &&
      mensagem.timestamp >= inicio && !existentes.has(id)
    ))) recibos.add(id);
  }
  cliente.on('message_create', observar);
  cliente.on('message_ack', observar);
  try {
    const enviada = await comPrazo(
      () => cliente.sendMessage(destino, texto, { sendSeen: false, waitUntilMsgSent: true }), prazoEnvio,
    );
    idDireto = idRecibo(enviada);
    observar(enviada);
    for (let i = 0; i < tentativas && !recibos.size; i++) {
      if (intervalo) await esperar(intervalo);
      const leituras = await Promise.all([
        ...fontes.filter((_, indice) => Array.isArray(linhasDeBase[indice]))
          .map(fonte => comPrazo(fonte, prazoLeitura)),
        ...(idDireto ? [comPrazo(() => cliente.getMessageById(idDireto), prazoLeitura)] : []),
      ]);
      for (const item of leituras.flat()) observar(item);
    }
    return recibos.size === 1 ? [...recibos][0] : null;
  } finally {
    cliente.removeListener('message_create', observar);
    cliente.removeListener('message_ack', observar);
  }
}
