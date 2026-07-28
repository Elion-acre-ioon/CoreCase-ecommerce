# 🚀 Guia de Deploy — Core Case E-commerce

> Versão revisada. A versão anterior deste guia descrevia um projeto em
> SQLite e citava um arquivo `netlify/functions/api.js` que na prática não
> existia. Este guia reflete a estrutura atual do projeto (MySQL + Netlify
> Functions de verdade).

---

## 1. Como o projeto está organizado hoje

```
api.js                     → toda a lógica de rotas (não sobe servidor sozinho)
server.js                  → entrada para rodar localmente (node server.js)
netlify/functions/api.js   → entrada para rodar na Netlify (serverless-http)
imageStorage.js            → salva imagens (Cloudinary ou disco local)
mercadopagoService.js      → integração com o Mercado Pago
public/                    → todo o frontend (HTML/CSS/JS estáticos)
netlify.toml               → configuração de build e redirects da Netlify
```

`server.js` e `netlify/functions/api.js` são só "adaptadores" — os dois
chamam a mesma lógica de `api.js`. Isso significa que qualquer rota nova
deve ser adicionada em `api.js`, nunca nos outros dois arquivos.

---

## 2. Banco de dados: MySQL (não é mais SQLite)

O projeto precisa de um MySQL acessível pela internet (a Netlify não hospeda
banco de dados). Opções gratuitas/baratas: **Railway**, **PlanetScale**,
**Aiven**, ou um MySQL gerenciado de qualquer provedor.

Depois de criar o banco, você vai ter host, usuário, senha, nome do banco e
porta — esses dados vão nas variáveis de ambiente (seção 4).

As tabelas (`usuarios`, `produtos`, `pedidos`, `configuracoes`) são criadas
automaticamente pelo próprio projeto na primeira vez que ele roda — você não
precisa criar nada manualmente.

---

## 3. Passo a passo do deploy

### Opção recomendada: Deploy via Git

1. Suba o projeto para um repositório no GitHub.
2. Acesse https://app.netlify.com → **Add new site** → **Import an existing project**.
3. Conecte o repositório.
4. Configurações de build (o `netlify.toml` já define isso, mas confirme):
   - **Build command**: `npm install`
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
5. Configure as variáveis de ambiente (seção 4) **antes** do primeiro deploy.
6. Clique em **Deploy site**.

---

## 4. Variáveis de ambiente (Site settings → Environment variables)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `MYSQL_HOST` | Sim | Endereço do banco MySQL |
| `MYSQL_USER` | Sim | Usuário do banco |
| `MYSQL_PASSWORD` | Sim | Senha do banco |
| `MYSQL_DATABASE` | Sim | Nome do banco |
| `MYSQL_PORT` | Não (padrão 3306) | Porta do banco |
| `ADMIN_TOKEN` | Sim, em produção | Token fixo usado pelo painel admin. Troque o padrão. |
| `ADMIN_USER` | Sim, em produção | Login do administrador mestre. |
| `ADMIN_SENHA` | Sim, em produção | Senha do administrador mestre. |
| `CLOUDINARY_CLOUD_NAME` | Não | Ativa upload de imagens na nuvem (ver seção 5) |
| `CLOUDINARY_API_KEY` | Não | Idem |
| `CLOUDINARY_API_SECRET` | Não | Idem |

Use o arquivo `.env.example` como referência (copie para `.env` para rodar
localmente).

---

## 5. Upload de imagens em produção

Por padrão (sem configurar Cloudinary), o projeto salva as fotos de produto e
de perfil em disco, na pasta `/uploads`. **Isso não funciona de forma
confiável na Netlify Functions**, porque o sistema de arquivos das functions
é temporário — as imagens podem sumir a qualquer momento.

Para produção, crie uma conta gratuita em https://cloudinary.com, pegue as
3 credenciais (Cloud Name, API Key, API Secret) e preencha as variáveis
`CLOUDINARY_*`. A partir daí, todo upload novo já vai direto para lá
automaticamente — não precisa mudar nada no código.

---

## 6. Webhook do Mercado Pago

A URL de notificação do webhook agora é calculada automaticamente a partir
do domínio de cada requisição — você não precisa configurar nada manualmente
no código. Só é preciso, no painel do Mercado Pago
(https://www.mercadopago.com.br/developers):

1. Ir em **Suas integrações → Webhooks**.
2. Cadastrar a URL: `https://SEU-SITE.netlify.app/api/webhook`.
3. Selecionar o evento **Pagamentos**.

---

## 7. Testando o site

### Login administrativo
Definido pelas variáveis `ADMIN_USER` / `ADMIN_SENHA` (veja seção 4). Se você
não configurar essas variáveis, o sistema usa `admin` / `System` como padrão
de desenvolvimento — **não deixe isso em produção**.

### Checklist de funcionalidades
- Listagem e busca de produtos
- Cadastro e login de usuários
- Checkout com Mercado Pago (Pix e Cartão)
- Atualização automática de status via webhook
- Painel administrativo (produtos, pedidos, usuários, financeiro)

---

## 8. Arquivos que podem ser removidos do projeto

Durante a revisão, identificamos arquivos que não são mais usados por
nenhuma página ou rota atual. Você pode apagá-los com segurança:

- `app.js` — versão antiga do frontend, nenhum HTML atual carrega esse script.
- `produto-detalhes.css` — CSS de uma versão anterior da página de produto; o `produto.html` atual usa estilos próprios embutidos.
- `banco.db` — banco SQLite de uma versão anterior do projeto (hoje é MySQL).
- `_redirects` — redundante com as regras de `[[redirects]]` já definidas em `netlify.toml`. Mantenha só um dos dois (recomendado manter o `netlify.toml`, que é mais completo).

---

## 9. Solução de problemas

**"Cannot find module 'mysql2'"** → rode `npm install` novamente; o
`package.json` já foi corrigido para incluir essa dependência.

**Função da API retorna 404** → confira se a pasta `netlify/functions` foi
enviada e se o `netlify.toml` está na raiz do projeto.

**Mercado Pago não recebe notificação** → confirme se cadastrou a URL do
webhook no painel do Mercado Pago (seção 6) e se as credenciais em
Admin → Financeiro estão corretas.

**Imagens somem depois de um tempo** → configure o Cloudinary (seção 5).
