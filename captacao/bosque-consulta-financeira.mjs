import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { coletarEspelhoLello } from './lello.mjs';

const autorizados = [
  ['1415010', '00044D'], ['1414133', '00073B'], ['1404546', '00112B'],
  ['1412323', '00122B'], ['1365663', '00132D'], ['1413311', '00214C'],
];
try {
  const { usuario, senha } = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64, 'base64')).lello.PADRAO;
  const resultado = await coletarEspelhoLello(
    { codigo: '182', nome: 'Bosque Marajoara', usuario, senha },
    AbortSignal.timeout(240_000), () => {}, undefined, autorizados,
  );
  const chave = randomBytes(32), iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifrador.update(gzipSync(JSON.stringify(resultado))), cifrador.final()]);
  const envelope = Buffer.concat([
    publicEncrypt({
      key: Buffer.from(process.env.PUBLIC_RESULT_KEY, 'base64'),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, chave),
    iv, cifrador.getAuthTag(), dados,
  ]).toString('base64');
  for (let i = 0; i < envelope.length; i += 2000) console.log('BOSQUE_FIN_' + (i / 2000) + '=' + envelope.slice(i, i + 2000));
  console.log('Consulta concluída. Fichas localizadas:', resultado.fichas.length);
} catch (erro) {
  if (/^SCANNER_AUTH_(RECUSADA|TRANSITORIA)$/.test(erro?.code ?? '')) console.error(erro.code);
  else console.error('Consulta pontual da Lello falhou.');
  process.exitCode = 1;
}
