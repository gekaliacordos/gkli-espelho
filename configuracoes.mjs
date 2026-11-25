export const modulosEspelho = [
  ["cadastro", "Cadastro"], ["captacao", "Captação"],
  ["acordo", "Acordo"], ["relatorios", "Relatórios"], ["mensageria", "Mensageria"],
];

export function configurarAdministracao({ authUrl, apiKey, obterToken, consultar }) {
  const botao = document.querySelector("#abrir-configuracoes");
  const painel = document.querySelector("#configuracoes");
  const feedback = painel.querySelector("[role=status]");
  const usuario = painel.querySelector("#config-usuario");
  const carteira = painel.querySelector("#config-carteira");
  const criarUsuario = painel.querySelector("#config-criar-usuario");
  const criarCarteira = painel.querySelector("#config-criar-carteira");
  const formUsuario = painel.querySelector("#config-editar-usuario");
  const formCarteira = painel.querySelector("#config-editar-carteira");
  const consultas = [
    ["espelho_usuarios", "id,email,administrador,modulos", "email.asc"],
    ["espelho_carteiras", "id,nome", "nome.asc"],
    ["condominios", "id,nome,administradora", "nome.asc,id.asc"],
    ["espelho_usuarios_carteiras", "usuario_id,carteira_id", "usuario_id.asc,carteira_id.asc"],
    ["espelho_carteiras_condominios", "carteira_id,condominio_id", "carteira_id.asc,condominio_id.asc"],
  ];
  let dados;

  function preencherSelect(select, itens, chave, rotulo, valor) {
    select.replaceChildren(new Option("Selecione", ""));
    for (const item of itens) select.add(new Option(item[rotulo], item[chave]));
    select.value = valor;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
  }

  function caixas(destino, itens, selecionados) {
    const legenda = destino.querySelector("legend");
    destino.replaceChildren(legenda);
    for (const [valor, nome] of itens) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = valor;
      input.checked = selecionados.includes(valor);
      label.append(input, nome);
      destino.append(label);
    }
  }

  function renderizarUsuario() {
    const [usuarios, carteiras, , vinculos] = dados;
    const selecionado = usuarios.find(item => item.id === usuario.value);
    formUsuario.hidden = !selecionado;
    caixas(painel.querySelector("#config-modulos"), modulosEspelho, selecionado?.modulos ?? []);
    caixas(painel.querySelector("#config-carteiras"), carteiras.map(item => [item.id, item.nome]),
      vinculos.filter(item => item.usuario_id === usuario.value).map(item => item.carteira_id));
  }

  function renderizarCarteira() {
    const [, , condominios, , vinculos] = dados;
    formCarteira.hidden = !carteira.value;
    caixas(painel.querySelector("#config-condominios"), condominios.map(item => [
      item.id, [item.nome, item.administradora].filter(Boolean).join(" · "),
    ]), vinculos.filter(item => item.carteira_id === carteira.value).map(item => item.condominio_id));
  }

  async function carregar(token, selecaoUsuario = usuario.value, selecaoCarteira = carteira.value) {
    const resultado = await Promise.all(consultas.map(async ([tabela, select, order]) => {
      const linhas = [];
      for (let offset = 0; ; offset += 500) {
        const pagina = await consultar(token, tabela, { select, order, offset, limit: 500 });
        linhas.push(...pagina);
        if (pagina.length < 500 || token !== obterToken()) return linhas;
      }
    }));
    if (token !== obterToken() || !painel.open) return;
    dados = resultado;
    preencherSelect(usuario, dados[0].filter(item => !item.administrador), "id", "email", selecaoUsuario);
    preencherSelect(carteira, dados[1], "id", "nome", selecaoCarteira);
    renderizarUsuario();
    renderizarCarteira();
  }

  async function enviar(token, rota, corpo) {
    const resposta = await fetch(new URL(rota, authUrl), {
      method: "POST",
      headers: { apikey: apiKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(20000),
    });
    const resultado = await resposta.json().catch(() => null);
    if (!resposta.ok) throw new Error(resultado?.mensagem ?? "Não foi possível concluir. Confira os dados e tente novamente.");
    return resultado;
  }

  const marcados = id => [...painel.querySelectorAll("#" + id + " input:checked")].map(input => input.value);

  function operacao(form, executar) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const token = obterToken();
      if (!token || !dados) return;
      const botaoSalvar = form.querySelector("button[type=submit]");
      botaoSalvar.disabled = true;
      feedback.textContent = "Salvando…";
      try {
        const { mensagem, usuarioId, carteiraId } = await executar(token);
        if (token !== obterToken() || !painel.open) return;
        feedback.textContent = mensagem;
        try {
          await carregar(token, usuarioId, carteiraId);
        } catch {
          if (token === obterToken() && painel.open) feedback.textContent = mensagem + " Reabra as configurações para atualizar a lista.";
        }
      } catch (erro) {
        if (token === obterToken() && painel.open) feedback.textContent = erro.message;
      } finally {
        botaoSalvar.disabled = false;
      }
    });
  }

  operacao(criarUsuario, async token => {
    const campos = new FormData(criarUsuario);
    criarUsuario.elements.senha.value = "";
    const { id } = await enviar(token, "/functions/v1/espelho-criar-usuario", {
      email: campos.get("email").trim(),
      senha: campos.get("senha"),
    });
    if (token === obterToken()) criarUsuario.reset();
    return { mensagem: "Usuário criado. Selecione os módulos e as carteiras para liberar o acesso.", usuarioId: id };
  });
  operacao(criarCarteira, async token => {
    const nome = new FormData(criarCarteira).get("nome").trim();
    const [nova] = await enviar(token, "/rest/v1/espelho_carteiras", { nome });
    if (token === obterToken()) criarCarteira.reset();
    return { mensagem: "Carteira criada. Selecione os condomínios que fazem parte dela.", carteiraId: nova.id };
  });
  operacao(formUsuario, async token => {
    await enviar(token, "/rest/v1/rpc/espelho_salvar_acessos", {
      usuario: usuario.value, modulos: marcados("config-modulos"), carteiras: marcados("config-carteiras"),
    });
    return { mensagem: "Acessos atualizados." };
  });
  operacao(formCarteira, async token => {
    await enviar(token, "/rest/v1/rpc/espelho_salvar_carteira", {
      carteira: carteira.value, condominios: marcados("config-condominios"),
    });
    return { mensagem: "Condomínios da carteira atualizados." };
  });

  usuario.addEventListener("change", renderizarUsuario);
  carteira.addEventListener("change", renderizarCarteira);
  painel.addEventListener("close", () => {
    dados = undefined;
    criarUsuario.reset();
    criarCarteira.reset();
    usuario.replaceChildren();
    carteira.replaceChildren();
    formUsuario.hidden = true;
    formCarteira.hidden = true;
  });
  botao.addEventListener("click", async () => {
    const token = obterToken();
    painel.showModal();
    feedback.textContent = "Carregando usuários e carteiras…";
    try {
      await carregar(token);
      if (token === obterToken() && painel.open) feedback.textContent = "";
    } catch {
      if (token === obterToken() && painel.open) feedback.textContent = "Não foi possível carregar as configurações.";
    }
  });
  return {
    definirAdministrador(admin) {
      botao.hidden = !admin;
      if (!admin && painel.open) painel.close();
    },
  };
}
