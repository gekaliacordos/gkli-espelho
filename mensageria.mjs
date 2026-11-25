const tipos = [
  ["regua", "Régua", [["inicio", "Início (dias)", "number"], ["duracao", "Duração (dias)", "number"]]],
  ["modelo", "Modelo de mensagem", [["assunto", "Assunto"], ["corpo", "Texto", "textarea"]]],
  ["smtp", "SMTP", [["carteira", "Carteira", "select"], ["remetente", "E-mail do remetente", "email"], ["host", "Servidor"], ["porta", "Porta", "number"]]],
];

function elemento(tag, texto) {
  const item = document.createElement(tag);
  if (texto) item.textContent = texto;
  return item;
}

function campo(pai, nome, entrada) {
  const label = elemento("label", nome);
  label.append(entrada);
  pai.append(label);
  return entrada;
}

function opcoes(select, itens) {
  const anteriores = new Set([...select.selectedOptions].map(item => item.value));
  select.replaceChildren(...itens.map(([id, nome]) => new Option(nome, id, false, anteriores.has(id))));
  select.disabled = !itens.length;
}

const valores = select => new Set([...select.selectedOptions].map(item => item.value));
const chaveCota = cota => JSON.stringify([cota.unidade, String(cota.recibo)]);

export function configurarMensageria({ consultar, obterToken, authUrl, apiKey }) {
  const grupo = document.querySelector("#config-mensageria");
  const destino = grupo.querySelector("#config-opcoes-mensageria");
  const eventos = new EventTarget();

  async function carregar() {
    const token = obterToken();
    if (!token || !grupo.open || !document.querySelector("#configuracoes").open) return;
    destino.textContent = "Consultando configurações…";
    try {
      const [opcoesSalvas, carteiras] = await Promise.all([
        consultar(token, "mensageria_opcoes", { select: "*", order: "nome" }),
        consultar(token, "espelho_carteiras", { select: "id,nome", order: "nome" }),
      ]);
      if (token !== obterToken()) return;
      destino.replaceChildren();
      for (const [tipo, titulo, campos] of tipos) {
        const secao = elemento("details");
        secao.append(elemento("summary", titulo));
        const form = elemento("form");
        form.className = "config-form";
        const seletor = campo(form, "Configuração", elemento("select"));
        const salvas = opcoesSalvas.filter(item => item.tipo === tipo);
        opcoes(seletor, [["", "Nova configuração"], ...salvas.map(item => [item.id, item.nome])]);
        const nome = campo(form, "Nome", elemento("input"));
        nome.required = true;
        nome.maxLength = 120;
        const entradas = campos.map(([chave, rotulo, tipoCampo]) => {
          const entrada = campo(form, rotulo, elemento(["textarea", "select"].includes(tipoCampo) ? tipoCampo : "input"));
          if (tipoCampo === "select") opcoes(entrada, carteiras.map(item => [item.id, item.nome]));
          if (entrada.tagName === "INPUT") entrada.type = tipoCampo || "text";
          if (tipoCampo === "number") entrada.min = chave === "inicio" ? "0" : "1";
          if (chave === "porta") entrada.max = "65535";
          entrada.required = true;
          return [chave, entrada];
        });
        if (tipo === "modelo") form.append(elemento("small", "Campos disponíveis {{condominio}}, {{unidade}}, {{cotas}}, {{total}} e {{data}}."));
        const salvar = elemento("button", "Salvar");
        const feedback = elemento("p");
        feedback.setAttribute("role", "status");
        form.append(salvar, feedback);
        seletor.addEventListener("change", () => {
          const item = salvas.find(opcao => opcao.id === seletor.value);
          nome.value = item?.nome ?? "";
          for (const [chave, entrada] of entradas) entrada.value = item?.dados[chave] ?? "";
        });
        form.addEventListener("submit", async event => {
          event.preventDefault();
          salvar.disabled = true;
          try {
            const rota = "/rest/v1/mensageria_opcoes" + (seletor.value ? "?id=eq." + seletor.value : "");
            const resposta = await fetch(new URL(rota, authUrl), {
              method: seletor.value ? "PATCH" : "POST",
              headers: { apikey: apiKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "return=representation" },
              body: JSON.stringify({ tipo, nome: nome.value.trim(), dados: { ...salvas.find(item => item.id === seletor.value)?.dados,
                ...Object.fromEntries(entradas.map(([chave, entrada]) =>
                [chave, entrada.type === "number" ? entrada.valueAsNumber : entrada.value.trim()])) } }),
            });
            if (!resposta.ok || !(await resposta.json()).length) throw new Error();
            eventos.dispatchEvent(new Event("change"));
            await carregar();
          } catch {
            feedback.textContent = "Não foi possível salvar a configuração.";
          } finally {
            salvar.disabled = false;
          }
        });
        secao.append(form);
        destino.append(secao);
      }
    } catch {
      destino.textContent = "Não foi possível carregar as configurações de Mensageria.";
    }
  }

  grupo.addEventListener("toggle", carregar);
  document.querySelector("#configuracoes").addEventListener("close", () => { grupo.open = false; });
  return eventos;
}

export async function montarMensageria({ destino, token, obterToken, consultar, captacoes, cadastro,
  consultarCaptacao, calcularRanking, lerReguaRanking, localizarCadastro, exibirPreviaCobranca,
  formatarCentavos, atualizarMensageria }) {
  destino.textContent = "Consultando carteiras e captações…";
  try {
    const [capturas, registros, vinculos] = await Promise.all([captacoes, cadastro,
      consultar(token, "rpc/mensageria_carteiras", {})]);
    if (token !== obterToken()) return;
    const carteira = elemento("select");
    const condominio = elemento("select");
    const unidade = elemento("select");
    const cota = elemento("select");
    const grade = elemento("div");
    grade.className = "mensageria-filtros";
    for (const [nome, select] of [["Carteiras", carteira], ["Condomínios", condominio], ["Unidades", unidade], ["Cotas", cota]]) {
      select.multiple = true;
      select.size = 6;
      campo(grade, nome, select);
    }
    const config = elemento("div");
    config.className = "mensageria-opcoes";
    const regua = campo(config, "Régua", elemento("select"));
    const modelo = campo(config, "Modelo de mensagem", elemento("select"));
    const smtp = campo(config, "SMTP de envio", elemento("select"));
    const gerar = elemento("button", "Gerar prévia");
    gerar.type = "button";
    const feedback = elemento("p");
    feedback.setAttribute("role", "status");
    const previa = elemento("div");
    destino.replaceChildren(elemento("h2", "Mensageria"), grade, config, gerar, feedback, previa);
    const porCadastro = new Map(registros.map(item => [item.cadastro, item]));
    const porCaptura = new Map(capturas.map(item => [String(item.id), {
      item, registro: porCadastro.get(localizarCadastro(item, registros)),
    }]));
    let catalogo = [];
    let pendencia = 0;
    let lotes = new Map();

    function limparPrevia() { previa.replaceChildren(); }
    function atualizarSmtp() {
      const carteiras = valores(carteira);
      opcoes(smtp, [["", "Sem perfil para a prévia"], ...catalogo.filter(item => item.tipo === "smtp" && item.dados.ativo !== false &&
        carteiras.has(item.dados.carteira)).map(item => [item.id, item.nome + " · " + item.dados.remetente])]);
      if (!smtp.value) smtp.selectedIndex = 0;
      limparPrevia();
    }
    async function carregarOpcoes() {
      if (token !== obterToken()) {
        atualizarMensageria.removeEventListener("change", carregarOpcoes);
        return;
      }
      try {
        catalogo = await consultar(token, "mensageria_opcoes", { select: "*", order: "nome" });
        for (const [select, tipo, padrao] of [[regua, "regua", "Régua do condomínio"], [modelo, "modelo", "Aviso inicial GKLI"]]) {
          opcoes(select, [["", padrao], ...catalogo.filter(item => item.tipo === tipo).map(item => [item.id, item.nome])]);
          if (!select.value) select.selectedIndex = 0;
        }
        atualizarSmtp();
        await carregarCotas();
      } catch {
        feedback.textContent = "Não foi possível carregar as opções de Mensageria.";
      }
    }

    function filtrarCotas() {
      limparPrevia();
      const selecionadas = valores(unidade);
      const itens = [];
      for (const [id, { captura, cotas }] of lotes) for (const parcela of cotas) {
        if (!selecionadas.has(JSON.stringify([id, parcela.unidade]))) continue;
        itens.push([JSON.stringify([id, chaveCota(parcela)]),
          captura.condominio + " · " + parcela.unidade + " · " + parcela.recibo + " · " + parcela.vencimento + " · " + formatarCentavos(parcela.saldo)]);
      }
      opcoes(cota, itens);
      gerar.disabled = !cota.selectedOptions.length;
    }

    async function carregarCotas() {
      const pedido = ++pendencia;
      const ids = [...valores(condominio)];
      limparPrevia();
      gerar.disabled = true;
      unidade.disabled = true;
      cota.disabled = true;
      feedback.textContent = ids.length ? "Consultando cotas elegíveis…" : "";
      try {
        const personalizada = catalogo.find(item => item.id === regua.value)?.dados;
        const resultado = await Promise.all(ids.map(async id => {
          const [captura] = await consultarCaptacao(token, id);
          const prazo = personalizada ? { inicio: personalizada.inicio, fim: personalizada.inicio + personalizada.duracao }
            : lerReguaRanking(porCaptura.get(id).registro?.cadastro);
          const cotas = captura && prazo ? calcularRanking(captura, prazo, { incluirCotasParaPrevia: true }).cotasParaPrevia : [];
          return [id, { captura, prazo, cotas: cotas.filter(item => item.saldo > 0) }];
        }));
        if (pedido !== pendencia || token !== obterToken()) return;
        lotes = new Map(resultado);
        opcoes(unidade, resultado.flatMap(([id, { captura, cotas }]) => [...new Set(cotas.map(item => item.unidade))]
          .map(nome => [JSON.stringify([id, nome]), captura.condominio + " · " + nome])));
        filtrarCotas();
        const semRegua = resultado.filter(([, item]) => !item.prazo).length;
        feedback.textContent = semRegua ? semRegua + " condomínio(s) sem régua configurada." :
          ids.length && !unidade.options.length ? "Nenhuma cota elegível para a seleção." : "";
      } catch {
        if (pedido !== pendencia || token !== obterToken()) return;
        lotes.clear();
        opcoes(unidade, []);
        filtrarCotas();
        feedback.textContent = "Não foi possível consultar as cotas.";
      }
    }

    const carteiras = new Map(vinculos.map(item => [item.carteira_id, item.nome]));
    opcoes(carteira, [...carteiras].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")));
    opcoes(condominio, []);
    opcoes(unidade, []);
    opcoes(cota, []);
    gerar.disabled = true;
    carteira.addEventListener("change", () => {
      const selecionadas = valores(carteira);
      const permitidos = new Set(vinculos.filter(item => selecionadas.has(item.carteira_id)).map(item => item.condominio_id));
      opcoes(condominio, [...porCaptura].filter(([, item]) => permitidos.has(item.registro?.id))
        .map(([id, { item }]) => [id, item.condominio + " · " + item.administradora]));
      atualizarSmtp();
      void carregarCotas();
    });
    condominio.addEventListener("change", carregarCotas);
    regua.addEventListener("change", carregarCotas);
    unidade.addEventListener("change", filtrarCotas);
    cota.addEventListener("change", () => { limparPrevia(); gerar.disabled = !cota.selectedOptions.length; });
    modelo.addEventListener("change", limparPrevia);
    smtp.addEventListener("change", limparPrevia);
    gerar.addEventListener("click", () => {
      limparPrevia();
      const perfil = catalogo.find(item => item.id === smtp.value);
      const selecionadas = [...valores(cota)].map(id => JSON.parse(id));
      const template = catalogo.find(item => item.id === modelo.value)?.dados;
      for (const [id, { captura, prazo }] of lotes) {
        const cotasSelecionadas = new Set(selecionadas.filter(([origem]) => origem === id).map(([, chave]) => chave));
        if (!cotasSelecionadas.size) continue;
        const painel = elemento("div");
        exibirPreviaCobranca(painel, captura, prazo, { cotas: cotasSelecionadas, modelo: template });
        const mesmoEscopo = perfil && vinculos.some(item => item.carteira_id === perfil.dados.carteira
          && item.condominio_id === porCaptura.get(id).registro?.id);
        painel.prepend(elemento("p", mesmoEscopo ? "Remetente da prévia · " + perfil.dados.remetente :
          "Prévia sem perfil SMTP para este condomínio"));
        previa.append(painel);
      }
    });
    atualizarMensageria.addEventListener("change", carregarOpcoes);
    if (!carteiras.size) feedback.textContent = "Nenhuma carteira com condomínios vinculados.";
    await carregarOpcoes();
  } catch {
    if (token === obterToken()) destino.textContent = "Não foi possível carregar a Mensageria.";
  }
}
