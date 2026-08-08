# Relatorio de Otimizacao da Pagina de Produto

## 1. Problema identificado

Usuarios vindos de trafego pago chegam diretamente em `/produto.html?id=4`. Em sessoes reais do Microsoft Clarity houve carregamentos completos em torno de 5,6s e ate 16s.

O fluxo analisado foi:

```text
produto.html
-> JavaScript inline carregarProduto()
-> GET /api/produtos/:id
-> Netlify Function / api.js
-> garantirBancoPronto()
-> MySQL
-> normalizarProduto()
-> renderizacao do produto
-> carregarAvaliacoes()
```

## 2. Causa provavel

A causa mais provavel para variacao grande em producao e a combinacao de:

- cold start da Netlify Function;
- tempo de `garantirBancoPronto()` / conexao MySQL;
- endpoint de produto sem cache publico curto;
- imagem principal carregada somente depois da resposta da API;
- miniaturas competindo com a imagem principal no carregamento inicial.

O endpoint ja usava uma consulta unica por ID. Nao encontrei chamada duplicada para carregar o produto.

## 3. Arquivos analisados

- `public/produto.html`
- `public/produto.css`
- `public/avaliacoes-ui.js`
- `public/usuario.js`
- `api.js`
- `netlify.toml`
- `package.json`
- `tests/auth-regression.test.js`

Tambem foi procurado uso de:

```text
window.webkit
window.webkit.messageHandlers
```

Resultado: nenhuma ocorrencia no codigo do projeto. O erro visto no Clarity nao foi tratado no codigo por nao haver evidencia de origem na aplicacao.

## 4. Arquivos efetivamente modificados

- `api.js`
- `public/produto.html`
- `tests/auth-regression.test.js`
- `RELATORIO_OTIMIZACAO_PRODUTO.md`

## 5. Alteracoes por arquivo

### api.js

Bloco alterado: `GET /api/produtos/:id`

Comportamento anterior:

```js
const [rows] = await db.execute(...);
if (rows.length === 0) return enviarJson(res, 404, ...);
enviarJson(res, 200, normalizarProduto(rows[0]));
```

Comportamento novo:

```js
const inicioProduto = agoraMs();
const [rows] = await db.execute(...);
const msProduto = agoraMs() - inicioProduto;
logPerf('produto_query', { id, ms: msProduto });
setServerTiming(res, [
    { name: 'dbready', dur: req.perfDbReadyMs || 0 },
    { name: 'product', dur: msProduto }
]);
```

Para produto encontrado:

```text
Cache-Control: public, max-age=0, s-maxage=20, stale-while-revalidate=30
```

Para produto inexistente:

```text
Cache-Control: no-store
```

Motivo exato:

- permitir cache curto de borda somente para leitura publica do produto;
- manter o navegador sempre revalidando (`max-age=0`);
- permitir que a CDN reduza impacto de cold start em trafego de anuncios;
- registrar `Server-Timing` e log `[perf] produto_query` para diagnostico real na Netlify;
- evitar cache de 404 para nao atrasar aparecimento de produto recem-criado.

Nao houve alteracao no JSON retornado.

### public/produto.html

Blocos alterados:

- `<head>`;
- HTML gerado para miniaturas;
- HTML gerado para imagem principal.

Comportamento anterior:

- nao havia preconnect para Cloudinary;
- imagem principal e miniaturas nao tinham prioridade declarada;
- miniaturas podiam competir com a imagem principal no carregamento inicial.

Comportamento novo:

```html
<link rel="preconnect" href="https://res.cloudinary.com" crossorigin>
```

Imagem principal:

```html
loading="eager" fetchpriority="high" decoding="async"
```

Miniaturas:

```html
loading="lazy" decoding="async"
```

Motivo exato:

- antecipar conexao com Cloudinary quando imagens estiverem hospedadas la;
- priorizar a imagem principal, que e parte do conteudo essencial acima da dobra;
- evitar que miniaturas secundarias disputem prioridade antes do usuario ver o produto.

Nao houve alteracao de layout, texto comercial, preco, variantes, carrinho ou checkout.

### tests/auth-regression.test.js

Blocos alterados:

- mock de produtos;
- testes de `GET /api/produtos/:id`.

Comportamento novo testado:

- `/api/produtos/4` retorna HTTP 200;
- contrato JSON mantem `id`, `nome`, `preco` e `preco_promocional`;
- header de cache curto e aplicado ao produto existente;
- `Server-Timing` inclui `product`;
- `/api/produtos/3` retorna outro produto e nao mistura cache/dados com ID 4;
- produto inexistente retorna HTTP 404 com `Cache-Control: no-store`.

## 6. Cache

Cache implementado: sim.

Onde: somente em `GET /api/produtos/:id`.

TTL:

```text
max-age=0
s-maxage=20
stale-while-revalidate=30
```

Headers utilizados:

```text
Cache-Control: public, max-age=0, s-maxage=20, stale-while-revalidate=30
Server-Timing: dbready;dur=..., product;dur=...
```

Motivo do TTL:

- 20 segundos e conservador para preco/estoque;
- reduz impacto de picos de trafego pago para o mesmo produto;
- evita cache longo de dados comerciais;
- segue o padrao ja existente de `/api/loja/bootstrap`, que usa o mesmo TTL.

Como evita dados perigosos:

- aplicado somente a endpoint publico `GET`;
- nao aplicado a login, sessao, carrinho, checkout, Mercado Pago, admin ou usuario;
- resposta do produto nao contem dado privado;
- 404 usa `no-store`;
- a chave de cache da CDN e por URL, entao `/api/produtos/4` e `/api/produtos/3` permanecem separados.

## 7. Otimizacoes de frontend realizadas

- `preconnect` para `https://res.cloudinary.com`;
- imagem principal com `fetchpriority="high"`;
- imagem principal com `loading="eager"`;
- miniaturas com `loading="lazy"`;
- imagens com `decoding="async"`.

Nao houve redesenho visual.

## 8. Testes executados

Comandos executados:

```text
npm test
npm run security:check
node --check api.js
node --check tests/auth-regression.test.js
git diff --check
```

Teste local por servidor:

```text
GET /produto.html?id=4
```

Resultado local:

```text
Status: 200
Tempo local medido: 528ms
Tamanho: 19929 bytes
Cache-Control: no-cache
```

Tentativa local do endpoint:

```text
GET /api/produtos/4
```

Resultado local:

```text
Status: 503
Motivo: MySQL local recusou conexao (ECONNREFUSED)
```

Esse 503 nao foi usado como metrica de performance do produto, pois o ambiente local nao reproduziu o banco de producao.

## 9. Resultado dos testes

`npm test`:

```text
tests 18
pass 18
fail 0
```

Casos relevantes novos:

- produto 4 retorna o contrato esperado;
- cache curto aparece no produto existente;
- `Server-Timing` inclui a metrica `product`;
- produto 3 e produto 4 nao misturam dados;
- produto inexistente retorna 404 com `no-store`;
- login normal e Google Login continuaram passando na suite existente;
- testes de comentarios/admin continuaram passando.

`npm run security:check`:

```text
[security:check] OK - 78 arquivos rastreados auditados.
```

`node --check api.js`: aprovado.

`node --check tests/auth-regression.test.js`: aprovado.

`git diff --check`: aprovado, apenas avisos locais de LF/CRLF.

## 10. Metricas de performance antes/depois

Nao foi possivel medir antes/depois real contra Netlify + MySQL de producao nesta maquina.

Metricas locais disponiveis:

```text
/produto.html?id=4 estatico: 528ms, 19929 bytes
/api/produtos/4 local: 503 por ECONNREFUSED no MySQL local
```

Metricas novas que devem aparecer em producao apos deploy:

```text
[perf] db_ready_ms path=/api/produtos/4 ms=...
[perf] produto_query id=4 ms=...
Server-Timing: dbready;dur=..., product;dur=...
```

Para validar em producao, comparar primeira chamada e segunda chamada para:

```text
/api/produtos/4
```

A segunda chamada pode ser atendida pela borda durante `s-maxage=20`.

## 11. Riscos conhecidos

- Durante ate 20 segundos, a CDN pode servir preco/estoque recentemente alterado antes de revalidar.
- O TTL foi mantido curto para reduzir esse risco.
- Se houver campanha com mudanca imediata de preco, aguardar a expiracao curta ou invalidar cache via novo deploy/configuracao externa.
- A melhoria nao elimina cold start em primeira requisicao nao cacheada.

## 12. Problemas encontrados mas nao corrigidos

- O erro `window.webkit.messageHandlers` nao aparece no codigo do projeto; provavel origem externa/navegador interno/Clarity. Nao foi criado workaround.
- O MySQL local recusou conexao, entao nao foi possivel medir TTFB real do endpoint local com banco.
- A pagina ainda depende da resposta do endpoint para renderizar nome/preco/imagem. Uma mudanca maior, como gerar snapshot estatico do produto, ficou fora do escopo por alterar arquitetura.

## 13. Confirmacao de escopo preservado

Nao foram alterados:

- login;
- autenticacao;
- cookies;
- autorizacao;
- carrinho;
- checkout;
- Mercado Pago;
- PIX;
- webhook;
- pedidos;
- estoque;
- regras comerciais;
- analytics;
- Meta Pixel;
- Clarity;
- GTM;
- banco/schema;
- migrations;
- Cloudinary;
- SMTP;
- comentarios.

## 14. Git diff resumido

Saida de `git diff --stat`:

```text
 api.js                        | 13 ++++++-
 public/produto.html           |  5 ++-
 tests/auth-regression.test.js | 81 ++++++++++++++++++++++++++++++++++++++++++-
 3 files changed, 96 insertions(+), 3 deletions(-)
```

Saida de `git status --short` antes da criacao deste relatorio:

```text
 M api.js
 M public/produto.html
 M tests/auth-regression.test.js
```

## 15. Conclusao

Considero a alteracao segura para revisao de producao.

O diff funcional e pequeno: cache publico curto no endpoint de produto, metricas de tempo para diagnostico e prioridade correta da imagem principal. A suite automatizada confirma que o contrato do produto foi preservado e que produtos diferentes nao misturam dados.

Nao foi feito commit, push ou deploy.
