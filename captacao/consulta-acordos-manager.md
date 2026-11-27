# Consulta pontual dos acordos da Manager

O coletor consulta **Acordos Online** do Atentum para os condomínios configurados em `alvos-manager.json`. A grade inclui os acordos em aberto de todas as unidades, com todas as parcelas exibidas, mesmo as que ainda não foram pagas. A consulta roda sob demanda e gera um arquivo privado para conferência.

Com as dependências do repositório instaladas pelo `npm ci` e o Google Chrome disponível, execute:

```sh
node captacao/consultar-acordos-manager.mjs --saida /pasta-privada/acordos-manager.json
```

O ambiente pode fornecer o acesso Manager no segredo já utilizado pelo coletor, `ESPELHO_PORTAIS_B64`. Quando o acesso vier de um leitor seguro, use `--acesso-stdin` para receber uma linha JSON com os campos `usuario` e `senha`, sem expor os valores no comando. O parâmetro `--condominios 2262,2272` limita a consulta aos códigos informados. Informe um novo caminho de saída em cada execução.

O arquivo registra a situação da consulta em cada condomínio e, quando a grade fecha, traz número do acordo, unidade, principal, total, valor recebido, saldo, período negociado e parcelas. Uma consulta indisponível fica marcada como tal e causa código de saída diferente de zero. A grade apresenta apenas acordos em aberto. Para conferir uma baixa, é necessário um status explícito na fonte. As colunas de composição financeira como despesas, honorários e desconto dependem de relatório próprio da administradora.
