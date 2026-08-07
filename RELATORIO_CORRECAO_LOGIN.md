# Relatorio de Correcao de Login

## 1. HEAD analisado

SHA:
`379802d5856d77c8b24917594e18f5fd0d3f80eb`

Commits usados para comparacao:
- `fc86978`
- `7d1720a`
- `b00271a`

## 2. Causa raiz - login normal/Google

CAUSA 1: o fast path de `schema_migrations` (versao 2) passou a pular corretamente as migrations e a verificacao estrutural completa, preenchendo `diagnosticoBanco.tabelas` e `diagnosticoBanco.colunas` com objetos vazios. As funcoes `tabelaAusente` e `colunaAusente`, porem, tratavam qualquer valor diferente de `true`, inclusive `undefined`, como ausencia confirmada. Assim, `criarSessaoUsuario` bloqueava o `INSERT INTO sessoes` antes de o MySQL ser consultado e gerava o falso erro `Tabela sessoes ausente.`. O mesmo erro semantico afetava todos os chamadores desses guardas.

Arquivos e linhas antes da correcao:
- `api.js`, funcoes `tabelaAusente` e `colunaAusente`, aproximadamente linhas 259-265.
- `api.js`, fast path de `inicializarBanco`, aproximadamente linhas 375-393.
- `api.js`, funcoes de sessao, recuperacao, Google e analytics que usam esses guardas.

## 3. Causa raiz - Admin

CAUSA 2: antes de `b00271a`, as credenciais `ADMIN_USER` e `ADMIN_SENHA` autenticavam o administrador sem exigir usuario correspondente no MySQL, mas devolviam `ADMIN_TOKEN` ao navegador. Em `b00271a`, a exposicao do token foi removida corretamente, porem o fluxo passou a consultar `usuarios` e exigir uma conta `is_admin=1` com nome ou e-mail igual a `ADMIN_USER`. Essa nova dependencia nao existia na instalacao atual e fazia o login administrativo retornar 503 mesmo com as variaveis corretas.

Arquivos e linhas antes da correcao:
- `api.js`, rota `/api/login` e `/api/auth/login`, aproximadamente linhas 1830-1860.
- `api.js`, `exigirAcessoAdmin`, aproximadamente linhas 1129-1141.
- `api.js`, endpoint `/api/auth/session` e logout, aproximadamente linhas 1663-1684.

## 4. Arquivos modificados

CAMINHO: `api.js`

MOTIVO: corrigir a semantica do diagnostico estrutural e restaurar o admin por variaveis de ambiente com sessao HttpOnly assinada, sem devolver `ADMIN_TOKEN` ao navegador.

CAMINHO: `tests/auth-regression.test.js`

MOTIVO: testar os fluxos de login e sessao por HTTP com MySQL e Google simulados, sem credenciais reais.

CAMINHO: `package.json`

MOTIVO: disponibilizar os testes pelo comando `npm test`.

CAMINHO: `scripts/security-check.js`

MOTIVO: limitar a verificacao de credencial administrativa em documentacao a arquivos Markdown. Sem isso, o script versionado interpretava sua propria expressao de busca como ocorrencia insegura.

CAMINHO: `RELATORIO_CORRECAO_LOGIN.md`

MOTIVO: registrar causas, alteracoes e evidencias antes de qualquer deploy.

Nenhum arquivo de frontend foi alterado. Nenhum arquivo de loja, checkout, pagamentos, categorias, SMTP, Cloudinary, analytics, CSS ou migration foi alterado.

## 5. Todas as alteracoes

### 5.1 Diagnostico estrutural

Funcao: `tabelaAusente` / `colunaAusente`

Linhas aproximadas: `api.js:268-274`

ANTES:

```js
return diagnostico && diagnostico.tabelas && diagnostico.tabelas[tabela] !== true;
```

DEPOIS:

```js
return diagnostico?.tabelas?.[tabela] === false;
```

Resultado: somente `false` explicito significa ausencia confirmada. `undefined`, inclusive no fast path com `{}`, deixa a operacao SQL real prosseguir. A correcao central alcanca sessao, recuperacao, Google e analytics sem remover os guardas de ausencia confirmada.

### 5.2 Sessao do admin de ambiente

Funcoes: `assinaturaSessaoAdmin`, `criarTokenSessaoAdmin`, `tokenSessaoAdminValido`, `obterSessaoAdminEnv` e `criarSessaoAdminEnv`

Linhas aproximadas: `api.js:1007-1050`

ANTES:

```js
SELECT ... FROM usuarios
WHERE is_admin = 1
AND (LOWER(email) = ? OR LOWER(nome) = ?)
```

DEPOIS:

```js
const admin = criarSessaoAdminEnv(req, res);
return enviarJson(res, 200, { sucesso: true, usuario: admin });
```

Resultado: `ADMIN_USER` e `ADMIN_SENHA` validos criam `cc_admin_session` sem consulta ou vinculacao obrigatoria ao MySQL. O payload contem apenas `type` e expiracao. A assinatura usa HMAC-SHA256 com `SESSION_SECRET`; a comparacao usa `crypto.timingSafeEqual`.

O cookie possui `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` de sete dias e `Secure` em producao. Nao contem senha, `ADMIN_TOKEN` ou `SESSION_SECRET`.

### 5.3 Autorizacao e sessao atual

Funcoes/rotas: `exigirAcessoAdmin`, `clienteAutorizado` e `GET /api/auth/session`

Linhas aproximadas: `api.js:1114`, `api.js:1185` e `api.js:1719`

Alteracao: passaram a reconhecer `cc_admin_session` valida, mantendo tambem usuario MySQL com `is_admin=1` e o suporte legado exclusivamente backend de `X-Admin-Token`.

Resposta publica do admin de ambiente:

```json
{
  "id": 0,
  "nome": "Administrador",
  "email": "valor de ADMIN_USER",
  "is_admin": 1
}
```

Nenhum segredo e retornado.

### 5.4 Login normal e Google

Funcao: `criarSessaoUsuario`

Linhas aproximadas: `api.js:1052-1066`

Alteracao: a funcao continua inserindo a sessao em `sessoes` e emitindo `cc_session`. A unica adicao e limpar eventual cookie administrativo ao trocar para uma conta normal. `senhaConfere`, PBKDF2, upgrade de senha antiga, rate limit e `verifyIdToken` nao foram alterados.

### 5.5 Logout

Funcao: `revogarSessaoAtual`

Linhas aproximadas: `api.js:1096-1104`

Alteracao: limpa `cc_session` e `cc_admin_session`. Quando existe sessao MySQL, continua marcando `revogado_em`. O logout do admin de ambiente nao depende do banco.

### 5.6 Testes isolados

O bloco `module.exports.__test` existe somente quando `NODE_ENV=test`. Ele permite substituir o acesso ao banco e o cliente Google durante os testes; nao e exportado em producao.

### 5.7 Itens deliberadamente preservados

- `SCHEMA_VERSION` continua em `2`.
- `inicializarBanco` e o fast path de `schema_migrations` nao foram revertidos.
- Nenhuma migration foi criada ou executada manualmente.
- `ADMIN_TOKEN`, `SESSION_SECRET`, `ADMIN_USER` e `ADMIN_SENHA` continuam vindo somente de `process.env`, sem fallback.
- `ADMIN_TOKEN` nao foi adicionado a respostas JSON ou ao frontend.
- Google Login manteve biblioteca, audience, vinculo de identidade e fluxo existentes.

## 6. Testes executados

`npm test` executou 12 testes e obteve:

```text
tests 12
pass 12
fail 0
```

Casos confirmados:

1. `tabelas={}` e `colunas={}` nao significam ausencia.
2. `tabelas.sessoes=false` continua bloqueando como ausencia real.
3. Login normal valido cria `cc_session` no fast path e `GET /api/auth/session` reconhece o usuario pelo cookie.
4. Senha incorreta retorna HTTP 401 e nao cria cookie.
5. Google mockado carrega usuario e cria `cc_session` sem alterar a integracao.
6. Admin por ambiente funciona sem usuario MySQL correspondente e sem consulta ao banco.
7. Senha incorreta do admin nao cria `cc_admin_session`.
8. `cc_admin_session` autoriza rota administrativa; requisicao anonima recebe 403.
9. Usuario MySQL com `is_admin=1` continua autorizado pela sessao normal.
10. Logout do admin remove `cc_admin_session`.
11. Logout do cliente revoga a sessao e remove `cc_session`.
12. A resposta do admin de ambiente nao possui campo `adminToken`.

Verificacoes estaticas realizadas:

- `node --check api.js`: aprovado.
- `node --check tests/auth-regression.test.js`: aprovado.
- `npm run security:check`: aprovado; 76 arquivos rastreados auditados.
- `npm install`: aprovado; dependencias ja estavam atualizadas.
- `git diff --check`: aprovado, sem erro de whitespace.
- Buscas por `adminToken`, fallback antigo, `SESSION_SECRET ||`, guardas estruturais e `admin_env`: auditadas.

Analise dos resultados das buscas:

- `adminToken`: aparece somente nas regras de `scripts/security-check.js` que impedem esse campo no frontend e nas respostas da API.
- `core-case-admin-token`: nenhuma ocorrencia.
- `SESSION_SECRET ||`: a unica correspondencia por substring e `if (!SESSION_SECRET || !token)`, uma validacao booleana; nao existe fallback ou atribuicao de `SESSION_SECRET` a outro segredo.
- `Tabela sessoes ausente`: permanece nos guardas corretos, agora acionados somente quando o diagnostico possui `sessoes === false`.
- `admin_env sem conta administrativa vinculada`: removido.

## 7. Resultado e limites

Os testes locais confirmam a restauracao dos contratos de autenticacao sem depender de MySQL, Google ou credenciais reais. Nao foi feito deploy, commit, push, alteracao de variavel Netlify ou modificacao manual do banco.

Limite: a validacao usa mocks isolados. A confirmacao final contra MySQL e Google reais deve ocorrer somente depois da revisao deste diff e do deploy autorizado pelo usuario.

Estado final local: arquivos modificados e nao commitados. Nenhum commit, push ou deploy foi realizado.

## Correção adicional encontrada na revisão pré-produção

### Causa do problema

A rota `POST /api/produtos/:id/comentarios` ainda usava a verificacao antiga:

```js
const admin = temAcessoAdmin(req);
```

Essa funcao reconhece somente o header legado `X-Admin-Token`. Depois da correcao de seguranca, o frontend deixou de receber `ADMIN_TOKEN`, entao um administrador autenticado por `cc_admin_session` era tratado como cliente anonimo dentro dessa rota e recebia HTTP 403 com a mensagem publica de login.

O restante das rotas administrativas ja usava `exigirAcessoAdmin()`, que reconhecia as tres formas validas:

- `cc_admin_session`;
- sessao normal `cc_session` de usuario com `is_admin=1`;
- `X-Admin-Token` legado, somente backend.

### Funcao nova utilizada

Arquivo: `api.js`

Linhas aproximadas: `1184-1197`

Foi criada a funcao sem efeito colateral:

```js
async function possuiAcessoAdmin(req) {
    if (temAcessoAdmin(req) || obterSessaoAdminEnv(req)) return true;
    const sessao = await obterSessaoAtual(req);
    return Boolean(sessao && Number(sessao.is_admin) === 1);
}
```

`exigirAcessoAdmin()` passou a usar essa funcao centralizada, preservando o mesmo retorno e a mesma mensagem das rotas administrativas.

### Rota de comentarios

Arquivo: `api.js`

Linhas aproximadas: `1621-1631`

ANTES:

```js
const admin = temAcessoAdmin(req);
```

DEPOIS:

```js
let admin = false;
try {
    admin = await possuiAcessoAdmin(req);
} catch (err) {
    logErroSeguro('[comentarios] ERRO stage=admin_permission_read', err);
    return enviarJson(res, err?.infraestrutura ? 503 : 500, { erro: 'Nao foi possivel validar sua permissao agora.' });
}
```

Com isso, a rota continua permitindo comentario de cliente normal via `usuario_id` e token legado de cliente, mas agora tambem reconhece corretamente administradores autenticados por cookie HttpOnly.

Se a leitura da sessao falhar por infraestrutura, a rota nao transforma isso em "nao autorizado"; ela registra log seguro e retorna erro temporario/interno apropriado.

### Arquivos modificados nesta correcao adicional

CAMINHO: `api.js`

MOTIVO: centralizar verificacao de privilegio administrativo e aplicar a mesma regra na criacao de comentarios.

CAMINHO: `tests/auth-regression.test.js`

MOTIVO: adicionar testes de regressao especificos para comentarios administrativos.

CAMINHO: `RELATORIO_CORRECAO_LOGIN.md`

MOTIVO: documentar a causa e a correcao encontrada na revisao pre-producao.

### Testes adicionados

Arquivo: `tests/auth-regression.test.js`

Linhas aproximadas: `214-264`

Casos adicionados:

1. Admin por `ADMIN_USER` / `ADMIN_SENHA` faz login, recebe `cc_admin_session` e cria comentario em `POST /api/produtos/1/comentarios` sem `X-Admin-Token` e sem `usuario_id`.
2. Usuario do banco com `is_admin=1` e `cc_session` cria comentario administrativo sem `usuario_id`.
3. Anonimo sem `usuario_id` continua recebendo HTTP 403.
4. `X-Admin-Token` legado continua criando comentario administrativo.

Os testes existentes de login normal e Google Login continuaram passando.

### Resultados executados

`npm test`:

```text
tests 16
pass 16
fail 0
```

`npm run security:check`:

```text
[security:check] OK - 76 arquivos rastreados auditados.
```

`node --check api.js`: aprovado.

`node --check tests/auth-regression.test.js`: aprovado.

`git diff --check`: aprovado, sem erro de whitespace. O Git exibiu apenas avisos locais de normalizacao LF/CRLF.

### Confirmacoes de seguranca e escopo

- `ADMIN_TOKEN` nao voltou ao frontend.
- Nenhum `adminToken` foi adicionado a HTML, JavaScript publico, JSON de login ou localStorage.
- O suporte `X-Admin-Token` continua somente como compatibilidade backend.
- Nenhuma migration foi criada.
- Nenhuma tabela ou coluna foi alterada.
- Nao houve alteracao de frontend, produtos, promocao, checkout, Mercado Pago, Cloudinary, SMTP, migrations ou performance.
- Nao houve commit, push ou deploy.

### git diff --stat

Saida registrada antes de incluir esta secao no relatorio:

```text
 api.js                    | 133 ++++++++++++++++++++++++++++++++++++++--------
 package.json              |   1 +
 scripts/security-check.js |   2 +-
 3 files changed, 112 insertions(+), 24 deletions(-)
```

Observacao: `git diff --stat` nao lista arquivos nao rastreados. O arquivo `RELATORIO_CORRECAO_LOGIN.md` e a pasta `tests/` aparecem no `git status --short`.

### git status --short

```text
 M api.js
 M package.json
 M scripts/security-check.js
?? RELATORIO_CORRECAO_LOGIN.md
?? tests/
```
