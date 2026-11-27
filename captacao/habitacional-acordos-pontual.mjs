import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import parsePdf from 'pdf-parse/lib/pdf-parse.js';
import { coletarHabitacional } from './habitacional.mjs';

function publicar(codigo,dados) {
  const chave = randomBytes(32);
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const criptografado = Buffer.concat([cifra.update(gzipSync(JSON.stringify(dados))), cifra.final()]);
  const envelope = Buffer.concat([publicEncrypt({key:Buffer.from(process.env.PUBLIC_RESULT_KEY,'base64'),
    padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},chave),iv,cifra.getAuthTag(),criptografado]).toString('base64');
  for(let i=0;i<envelope.length;i+=1700) console.log('HABITA_'+codigo+'_'+(i/1700)+'='+envelope.slice(i,i+1700));
}

async function inspecionar([codigo,nome],bytes,menus) {
  const paginas = [];
  const pdf = await parsePdf(bytes,{pagerender:async pagina=>{
    const dados = await pagina.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
    const cels=dados.items.map(x=>[Math.round(x.transform[4]*100)/100,Math.round(x.transform[5]*100)/100,x.str])
      .filter(x=>x[2].trim());
    paginas.push(cels);
    return cels.map(x=>x[2]).join(' ');
  }});
  const ids=[...(pdf.text.matchAll(/(?:^|Condomínio:\s*)(\d{4})\s*-\s*(.*?)\s*CNPJ:/gm))];
  const legendaCompleta=pdf.text.includes(codigo+' - '+nome) && pdf.text.includes('CNPJ:');
  if(!(ids.length ? ids.every(x=>x[1]===codigo && x[2].trim()===nome) : legendaCompleta)) throw Error('Identidade do PDF divergente.');
  publicar(codigo,{codigo,nome,consultadoEm:new Date().toISOString(),paginas,menus});
  console.log('Relatório confirmado.',codigo,'Páginas:',paginas.length);
}

try {
  const acesso = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64,'base64')).habitacional;
  let erros=0;
  await coletarHabitacional(acesso,async(codigo,_nome,consultar)=>{
    try { await consultar(); }
    catch { erros++; console.log('Relatório indisponível.',codigo); }
  },inspecionar);
  if(erros)process.exitCode=1;
} catch {
  console.log('Sessão ou acesso Habitacional indisponível.');
  process.exitCode=1;
}
