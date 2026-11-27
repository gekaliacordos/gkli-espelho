import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { alvosManager, coletarManager } from './manager.mjs';

const { values } = parseArgs({ options: {
  saida: { type: 'string' },
  condominios: { type: 'string' },
  'acesso-stdin': { type: 'boolean' },
} });
const codigos = new Set(values.condominios?.split(',').map(c => c.trim().replace(/^manager-/, ''))
  ?? alvosManager.map(a => a.codigo));
if (!values.saida || [...codigos].some(c => !alvosManager.some(a => a.codigo === c))) {
  console.error('Informe --saida e, se necessário, códigos cadastrados em --condominios.');
  process.exitCode = 1;
} else {
  await consultar();
}

async function consultar() {
  const resultados = [];
  let falhaDeAcesso = false;
  try {
    let credenciais;
    if (values['acesso-stdin']) {
      const entrada = createInterface({ input: process.stdin, terminal: false });
      try {
        for await (const linha of entrada) {
          credenciais = JSON.parse(linha);
          break;
        }
      } finally {
        entrada.close();
      }
    } else {
      credenciais = JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64 ?? '', 'base64')).manager;
    }
    if (!credenciais?.usuario || !credenciais?.senha) throw Error('Acesso Manager indisponível.');
    await coletarManager(credenciais, async (codigo, condominio, executar) => {
      try {
        const { acordos, filtro } = await executar((_etapa, operacao) => operacao());
        resultados.push({ codigo, condominio, consultadoEm: new Date().toISOString(), situacao: 'conferido', filtro, acordos });
        console.log(codigo, 'consultado. Acordos encontrados:', acordos.length);
      } catch {
        resultados.push({ codigo, condominio, consultadoEm: new Date().toISOString(), situacao: 'indisponivel' });
        console.warn(codigo, 'consulta indisponível.');
      }
    }, { codigos, somenteAcordos: true });
  } catch {
    falhaDeAcesso = true;
    console.error('O acesso ao Atentum não foi confirmado nesta execução.');
  }
  try {
    await writeFile(values.saida, JSON.stringify({
      fonte: 'Manager Atentum · Acordos Online', abrangencia: 'Somente em Aberto',
      falhaDeAcesso, alvos: [...codigos].map(c => 'manager-' + c), resultados,
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch {
    console.error('Não foi possível salvar o arquivo de saída. Use um caminho novo e gravável.');
    process.exitCode = 1;
  }
  if (falhaDeAcesso || resultados.length !== codigos.size || resultados.some(r => r.situacao !== 'conferido')) process.exitCode = 1;
}
