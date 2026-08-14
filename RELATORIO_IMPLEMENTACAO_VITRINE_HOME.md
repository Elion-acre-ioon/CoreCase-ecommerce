# Relatorio de Implementacao da Vitrine e Home

## 1. Resumo

Foi substituida a Home temporaria por uma Home comercial dinamica, com Hero de ate tres produtos, seletor por nome, cards de categorias, rodape publico e fallback de carregamento. Foi adicionada a aba administrativa Vitrine, com gerenciamento independente de Destaques, Categorias em destaque e Rodape.

## 2. Estado anterior

`public/index.html` exibia apenas uma tela de manutencao com link para a Loja. O cabecalho compartilhado ja era montado por `header.js`, a Loja ja filtrava por `?categoria=slug`, categorias e produtos ja tinham endpoints proprios e as imagens ja usavam `imageStorage.salvarImagemBase64()` com Cloudinary em producao.

## 3. Arquivos analisados

- `public/index.html`, `public/index-vitrine-anterior.html`, `public/style.css`, `public/header.js`, `public/usuario.js`.
- `public/loja.html`, `public/admin.js`, `public/admin-style.css`, `public/admin-produtos.html`, `public/admin-categorias.html`, `public/admin-loja.html`.
- `api.js`, `imageStorage.js`, `server.js`, `netlify.toml`, `package.json`.
- `tests/auth-regression.test.js`.

## 4. Arquivos modificados

- `api.js`
- `public/admin.js`
- `public/index.html`
- `tests/auth-regression.test.js`

## 5. Arquivos novos

- `public/home.css`
- `public/home.js`
- `public/admin-vitrine.html`
- `RELATORIO_IMPLEMENTACAO_VITRINE_HOME.md`

## 6. Alteracoes por arquivo

### `api.js`

- Versao do schema passou de 2 para 3 somente para instalar os campos da Vitrine.
- Foram adicionados validacao, leitura, gravacao e montagem publica da configuracao.
- Foram adicionadas as rotas `GET /api/vitrine`, `GET /api/admin/vitrine` e `PUT /api/admin/vitrine`.
- Antes nao existia persistencia nem API da Home. Agora as tres secoes sao administraveis e validadas no servidor.

### `public/admin.js`

- Adicionado apenas o link Vitrine ao menu administrativo compartilhado.

### `public/index.html`

- Removida a composicao temporaria de manutencao.
- Mantidos `analytics.js`, `style.css`, `header.js` e `usuario.js`.
- Adicionadas as regioes dinamicas do Hero, categorias, fallback e rodape.

### `public/home.css` e `public/home.js`

- Estilos e comportamento ficaram isolados da folha global.
- O JavaScript usa criacao de elementos e `textContent` para dados dinamicos.
- O carrossel so cria a imagem do destaque visivel; imagens seguintes nao competem com a primeira.

### `public/admin-vitrine.html`

- Nova pagina no padrao atual do Admin, usando `montarNavAdmin('vitrine')` e `adminFetch`.
- Inclui criar, editar, ativar, desativar e remover configuracoes sem apagar imagens do Cloudinary.

### `tests/auth-regression.test.js`

- O banco simulado passou a representar a configuracao da Vitrine.
- Foram adicionados testes de acesso, upload, dados publicos, limite de ativos e validacao do rodape.
- Os testes anteriores de login, Google, sessoes, comentarios e produto foram preservados.

## 7. Persistencia

Foi reutilizada a tabela de linha unica `configuracoes`, por ser a alternativa com menor impacto. A migration idempotente adiciona:

```text
home_vitrine_destaques_json LONGTEXT NULL
home_vitrine_categorias_json LONGTEXT NULL
home_vitrine_rodape_json TEXT NULL
```

Nao foi criada tabela paralela. Os JSONs guardam somente IDs associados, URLs publicas das imagens, ordem, status e textos publicos. A versao 3 so e registrada depois que a migration e a existencia dos tres campos forem confirmadas; em falha, a inicializacao pode tentar novamente em outro cold start.

## 8. API publica

`GET /api/vitrine` retorna apenas itens ativos e ainda existentes no banco:

```json
{
  "destaques": [{ "produto_id": 4, "produto_nome": "Produto", "imagem_desktop": "https://...", "imagem_mobile": null, "ordem": 1 }],
  "categorias": [{ "categoria_id": 10, "categoria_nome": "Fones", "categoria_slug": "fones", "imagem": "https://...", "legenda": "Seu som, em qualquer lugar.", "ordem": 1 }],
  "rodape": { "email": "corecasesolucoes@gmail.com", "descricao": "..." }
}
```

O endpoint usa `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60` e `Server-Timing`. Nenhuma configuracao privada e retornada.

## 9. API administrativa

- `GET /api/admin/vitrine`: le a configuracao completa, com `Cache-Control: no-store`.
- `PUT /api/admin/vitrine`: salva uma secao por vez (`destaques`, `categorias` ou `rodape`).
- Ambas usam `exigirAcessoAdmin(req, res)`, o mesmo controle real dos demais endpoints administrativos.
- IDs de produto e categoria sao confirmados no MySQL. O servidor limita tres destaques ativos e impede duas posicoes ativas iguais.

## 10. Imagens

- Upload por arquivo local, convertido para Base64 somente no navegador.
- Formatos aceitos: JPEG, PNG e WebP; limite de 2 MB por arquivo.
- O backend chama `imageStorage.salvarImagemBase64()` com prefixos exclusivos da Vitrine, reutilizando Cloudinary quando configurado.
- Desktop recomenda 1,91:1; mobile opcional recomenda 4:5.
- Sem imagem mobile, a Home usa a desktop com `object-fit: cover`, sem deformacao.
- Imagens antigas podem ficar orfas ao substituir/remover. Elas nao sao apagadas automaticamente para evitar exclusao acidental.

## 11. Home

- Hero inteiramente clicavel para `/produto.html?id=ID` e CTA com o mesmo destino.
- Um destaque nao mostra controles; dois ou tres mostram setas e seletor pelos nomes.
- Rotacao automatica a cada 7 segundos, pausada em hover/foco e desativada com `prefers-reduced-motion`.
- Swipe horizontal simples foi implementado com eventos de ponteiro.
- Cards inteiros clicaveis, imagem com `scale(1.03)` somente no desktop e sem alterar dimensoes.
- Rodape preto com detalhe vermelho, navegacao, contato oficial ja encontrado no Login e ano dinamico.

## 12. Filtros

A Loja ja usa `new URLSearchParams(window.location.search)` e o parametro `categoria`. A Home apenas cria links no mesmo formato:

```text
/loja.html?categoria=fones
```

`loja.html` nao foi alterada.

## 13. Seguranca

- Escritas exigem administrador no backend.
- O endpoint publico nao retorna IDs de configuracao, itens inativos, credenciais ou dados administrativos.
- URLs de imagens existentes nao sao aceitas cegamente no payload: sao preservadas a partir do valor ja salvo ou substituidas pelo resultado do storage.
- Nomes e legendas publicos sao renderizados com `textContent`.
- Legenda limitada a 120 caracteres, descricao a 240 e e-mail validado no servidor.
- Busca direta nos novos arquivos nao encontrou nomes ou usos de segredos.

## 14. Performance

- O primeiro banner usa `loading="eager"`, `fetchpriority="high"`, `decoding="async"` e preconnect para Cloudinary.
- Somente o slide atual entra no DOM; os demais banners carregam quando selecionados.
- Cards de categoria usam lazy loading.
- Aspect ratios reservam espaco e reduzem CLS.
- API publica faz no maximo uma consulta de configuracao, uma consulta em lote de produtos e uma consulta em lote de categorias, sem N+1.

## 15. Testes executados

- `npm test`.
- `node --check api.js`.
- `node --check public/home.js`.
- `node --check tests/auth-regression.test.js`.
- Compilacao do JavaScript inline de `admin-vitrine.html` com `new Function`.
- `git diff --check` e busca de espacos finais nos arquivos novos.
- `npm run security:check`.
- Testes visuais e funcionais locais com respostas de API simuladas, sem banco ou hospedagem.

## 16. Resultados

- Suite: 24 testes aprovados, 0 falhas.
- Vitrine publica vazia: 200, arrays vazios e fallback seguro.
- Visitante escrevendo no Admin: 403.
- Upload simulado confirmou os prefixos de desktop, mobile e categoria no storage existente.
- Quatro destaques ativos: 400.
- E-mail invalido: 400.
- Item inativo: omitido da API publica.
- Carrossel: 0 banners sem bloco; 1 sem controles; 2 com dois seletores; 3 com tres seletores; erro mostra acesso alternativo a Loja.
- Navegacao testada: banner de produto 4 abriu `/produto.html?id=4`; categoria Fones abriu `/loja.html?categoria=fones`.

Evidencia de largura:

```text
360 solicitado: clientWidth=345, scrollWidth=345, overflow=false
390 solicitado: clientWidth=375, scrollWidth=375, overflow=false
768 solicitado: clientWidth=753, scrollWidth=753, overflow=false
1366 solicitado: clientWidth=1351, scrollWidth=1351, overflow=false
1440 solicitado: clientWidth=1425, scrollWidth=1425, overflow=false
```

A diferenca de 15 px e a barra vertical do navegador de teste, nao overflow horizontal. Em 390 px foi usada a imagem mobile; ao selecionar um destaque sem imagem mobile, a imagem desktop foi usada.

`npm run security:check` terminou com falha exclusivamente porque cinco documentos rastreados ja estavam apagados antes desta tarefa e o script exige que eles existam: `IMPLEMENTATION_NOTES.md`, `RELATORIO_CORRECAO_LOGIN.md`, `RELATORIO_CORRECOES_MOBILE_TAGS.md`, `RELATORIO_OTIMIZACAO_PRODUTO.md` e `SECURITY.md`. Esses arquivos nao foram restaurados nem alterados nesta tarefa.

## 17. Regressoes

- Login tradicional, Google Login, sessao admin, logout e comentarios continuaram aprovados na suite.
- Produto por ID e seu cache continuaram aprovados.
- Carrinho, checkout, Mercado Pago, analytics e categorias nao tiveram codigo alterado.
- Checkout e Mercado Pago nao foram executados contra servicos reais nesta rodada.

## 18. Problemas encontrados fora do escopo

- Os cinco documentos rastreados listados acima estavam marcados como excluidos no inicio do trabalho.
- Nao havia MySQL local disponivel para executar a migration real duas vezes. A migration foi revisada como idempotente (`INFORMATION_SCHEMA` antes de `ALTER`) e protegida para nao registrar a versao 3 em falha, mas a aplicacao em MySQL real fica para o deploy controlado.
- O upload foi validado com mock de `imageStorage.salvarImagemBase64`; nenhum arquivo foi enviado ao Cloudinary de producao.

## 19. Git diff

Diff rastreado desta implementacao antes do relatorio:

```text
api.js                        | 323 linhas alteradas
public/admin.js               |   1 linha adicionada
public/index.html             | 112 linhas alteradas
tests/auth-regression.test.js | 153 linhas alteradas
4 files changed, 518 insertions(+), 71 deletions(-)
```

Arquivos novos: `public/home.css`, `public/home.js`, `public/admin-vitrine.html` e este relatorio. O `git status --short` tambem mostra as cinco exclusoes preexistentes documentadas na secao 16.

## 20. Riscos conhecidos

- O usuario com permissao de migration precisa poder executar `ALTER TABLE configuracoes`.
- Alteracoes da Vitrine podem levar ate aproximadamente 30 segundos para se refletir em todos os pontos do CDN.
- Imagens substituidas nao sao removidas automaticamente do Cloudinary.
- A validacao completa da migration e do upload real deve ocorrer primeiro em ambiente de revisao.

## 21. Producao

Considero seguro para REVISAO antes de producao: **SIM**.

Nao foi feito commit, push, deploy, alteracao manual no MySQL ou alteracao de variavel da Netlify.
