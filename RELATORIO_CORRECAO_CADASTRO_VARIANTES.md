# Relatório — correção do cadastro e preço por versão

## Diagnóstico

- A demora estava concentrada no fluxo de imagens: o Admin convertia todas as fotos para Base64, colocava tudo no mesmo JSON de criação e o backend enviava cada imagem ao Cloudinary sequencialmente antes do `INSERT`.
- Base64 aumenta o volume binário em aproximadamente 33%, além do envelope JSON. O limite anterior era de até 100 variantes, mas não havia limite explícito de quantidade ou tamanho das fotos no Admin.
- As duplicatas eram possíveis porque o formulário não possuía trava de submit. Cada clique iniciava outro POST completo e o servidor não tinha idempotência persistente.
- A impressão de que o produto não aparecia era reforçada por falta de estado visual durante o upload e por `carregarProdutos()` não aguardado, seguido de `setTimeout(..., 400)` para abrir o item.
- As consultas existentes já tinham métricas de dezenas/centenas de milissegundos; não foi encontrada evidência que justificasse mudança no MySQL de produtos.
- Não foi possível medir Cloudinary/Netlify reais localmente. Portanto não há número inventado de tempo antes/depois nem confirmação empírica de timeout da função ou do limite de payload em produção.
- Os avisos de `/uploads` e `/public` foram preservados como comportamento normal de serverless.

## Mudanças

### `public/admin-produtos.html`

- Antes: submit concorrente, botão ativo, feedback apenas no fim, imagens Base64 dentro do POST do produto e espera fixa de 400 ms.
- Agora: trava imediata, botão `disabled`, estados “Enviando imagens...”/“Salvando produto...”, reativação no `finally`, upload antecipado, `await carregarProdutos()` e `await editarProduto(id)`.
- Foram adicionados limite de 10 imagens e 5 MB por imagem, chave idempotente por nova criação e campo opcional de preço em cada versão.
- A edição preserva preços existentes e exibe vazio para versões antigas sem preço.

### `api.js`

- Migration idempotente mínima cria `produto_idempotencia`, sem alterar pedidos, usuários ou pagamentos.
- Novo `POST /api/admin/uploads/produtos`, protegido por Admin, valida JPEG/PNG/WebP/GIF e 5 MB, reutiliza `imageStorage`/Cloudinary e retorna somente a URL.
- O POST de produto exige `Idempotency-Key`, associa chave + hash do payload ao ID e retorna o mesmo ID em repetição. O `INSERT` do produto e a confirmação da chave são atômicos em transação.
- Logs seguros: `produto_images_upload`, `produto_insert` e `produto_save`, somente com tempo, contagem e ID.
- O sanitizador/normalizador passou a aceitar `preco` monetário finito, não negativo, arredondado a centavos ou `null`.
- O checkout encontra a versão exata, rejeita versão inexistente e calcula o preço no servidor. Erros de produto não devolvem stack trace.

### `public/produto.html`

- Uma função central obtém o preço efetivo da versão: preço próprio válido ou preço geral/promocional atual.
- Trocar a versão atualiza preço, estoque e imagem sem recarregar.
- O carrinho recebe nome da versão, foto e preço visual correspondentes.

### `public/usuario.js`

- A normalização do carrinho passou a preservar `variante`, evitando perder essa informação ao recarregar o armazenamento local.

### `tests/auth-regression.test.js`

- Mock mínimo para idempotência/transação e testes de chave repetida/nova chave.
- Testes de A/B/C (39,90 / 69,90 / fallback 59,90), entrada inválida, versão inexistente e preço adulterado de 1,00.
- Verificação do bloqueio de submit, reativação em `finally` e remoção do `setTimeout` de sincronização.

## Idempotência

- Persistência: tabela MySQL `produto_idempotencia` com chave primária, hash do payload e ID criado.
- Mesma chave + mesmo payload concluído: HTTP 200, mesmo ID e nenhuma nova linha de produto.
- Mesma chave durante processamento: HTTP 409 informando que a operação ainda está em andamento.
- Mesma chave + payload diferente: HTTP 409.
- Nova chave: permite outro produto, mesmo que os dados sejam semelhantes.
- Falha antes da criação remove a reserva incompleta para permitir nova tentativa; transação evita produto criado sem confirmação idempotente.

## Upload

- Antes: todas as imagens Base64 no POST de criação; uploads sequenciais dentro da função de produto.
- Agora: uma chamada administrativa validada por imagem; o POST final contém dados e URLs. Cloudinary permanece o único armazenamento de produção.
- O upload no Admin permanece sequencial para não sobrecarregar Cloudinary e para apresentar progresso determinístico; a ordem visual é preservada.
- Tamanho máximo depois: cada requisição de upload contém no máximo uma imagem de 5 MB (Base64 tem sobrecarga aproximada de 33%); o POST final não contém Base64.
- Tempos reais de rede não foram mensurados porque o ambiente local não reproduz Cloudinary/Netlify de produção. Os novos logs permitirão medi-los com segurança.

## Preço por versão

Estrutura final:

```json
{ "nome": "30x80", "imagem": null, "estoque": 10, "preco": 69.90 }
```

- `preco: null` usa `precoEfetivo(produto)`, preservando promoções gerais e produtos antigos.
- O card da loja não foi alterado; continua usando o preço geral de referência para reduzir risco.
- Admin, página do produto, carrinho e checkout usam a versão, cada um dentro de sua responsabilidade.

## Segurança

O preço exibido/enviado pelo navegador é apenas informativo. O checkout busca o produto no banco, normaliza as variantes, exige correspondência exata, valida estoque e recalcula preço/subtotal no servidor. `pedido_itens.preco_unitario` e `produtos_json` recebem o preço confirmado pelo servidor através de `itensConfirmados`.

## Testes e resultados

- `npm test`: **PASS**, 27/27.
- `node --check api.js`: **PASS**.
- `git diff --check`: **PASS** (apenas avisos de conversão LF/CRLF).
- `npm run security:check`: **FAIL por estado preexistente** — o script tenta auditar `RELATORIO_CORRECAO_BANNER_HOME.md` e `RELATORIO_IMPLEMENTACAO_VITRINE_HOME.md`, que já estavam removidos antes desta tarefa.
- Idempotência mesma chave/nova chave: **PASS**.
- Preços A/B/C, versão inválida e preço adulterado: **PASS**.
- Trava de submit e reativação após erro/fim: **PASS** por teste de contrato do formulário.
- Suíte não possui automação ponta a ponta real de navegador, Cloudinary, MySQL de produção ou Mercado Pago; esses pontos não foram simulados como se fossem medição real.

## Regressões

- Login/Admin: coberto pela suíte, PASS.
- Carrinho: preservação de variante corrigida; cálculo visual coberto por função, sem E2E de navegador.
- Checkout: recálculo server-side preservado e ampliado; Mercado Pago não foi refatorado.
- Home, Vitrine, categorias e comentários: testes existentes PASS; arquivos dessas áreas não foram alterados.
- Mercado Pago, PIX, webhook, e-mail, analytics e financeiro: não alterados.

## Git diff

Arquivos desta tarefa: `api.js`, `public/admin-produtos.html`, `public/produto.html`, `public/usuario.js`, `tests/auth-regression.test.js` e este relatório.

O worktree já continha, antes da tarefa, dois relatórios removidos e `bom dia.md` não rastreado; esses itens foram preservados sem alteração.

## Produção

Considero seguro para REVISÃO antes de produção: **SIM**, condicionado à revisão da migration em ambiente de homologação e a um teste manual com Cloudinary/Netlify reais. Nenhum deploy, commit, push, merge ou alteração manual em banco de produção foi realizado.
