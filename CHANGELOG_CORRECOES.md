# Changelog — Correções aplicadas (seções 10 e 11 da documentação)

Este arquivo mapeia cada item apontado na documentação para a correção
correspondente nos arquivos, pra você conseguir rastrear rapidamente o que
mudou e por quê.

| # | Problema (seção 10/11) | Onde foi corrigido | O que mudou |
|---|---|---|---|
| 1 | `mysql2` faltando no `package.json` | `package.json` | Dependência adicionada. `pg` (não usado) e `express` (não usado, o projeto usa `http` nativo) foram removidos para não confundir. |
| 2 | Netlify Functions não existia de verdade | `api.js` (novo) + `server.js` (reescrito) + `netlify/functions/api.js` (novo) | A lógica de rotas foi extraída do `server.js` para `api.js`, que exporta só a função `handleRequest(req, res)`. `server.js` (local) e a function da Netlify agora reaproveitam essa mesma função — sem duplicar código. |
| 3 | `DEPLOY_NETLIFY.md` desatualizado (falava de SQLite) | `DEPLOY_NETLIFY.md` | Reescrito do zero refletindo MySQL, a nova estrutura de arquivos e as variáveis de ambiente reais. |
| 4 | Upload de imagem em disco não é persistente em serverless | `imageStorage.js` (novo) + `api.js` | Novo módulo que usa Cloudinary quando configurado (variáveis `CLOUDINARY_*`), com fallback automático para disco local em dev. |
| 5 | `app.js` órfão | — | Recomendado remover (não usado por nenhum HTML atual). Não incluído neste pacote de correções. |
| 6 | `produto-detalhes.css` órfão | — | Recomendado remover (não referenciado por nenhum HTML atual). Não incluído neste pacote de correções. |
| 7 | `banco.db` (SQLite legado) | — | Recomendado apagar do projeto local — não é lido por nada no código atual. |
| 8 | Bug de digitação: resposta `{ Bird: ... }` | `api.js`, rota `PUT /api/usuarios/:id` | Corrigido para `{ sucesso: ... }`, igual às demais rotas. |
| 9 | Login admin fixo no código (`admin` / `System`) | `api.js` | Passa a vir de `ADMIN_USER` e `ADMIN_SENHA` (variáveis de ambiente), com aviso no console se estiverem usando o valor padrão. |
| 10 | `ADMIN_TOKEN` padrão exposto | `api.js` | Continua com um valor padrão só para não travar o ambiente local, mas agora emite um aviso claro no console pedindo para configurar via variável de ambiente em produção. |
| 11 | `notification_url` hardcoded (`seu-dominio.com`) | `api.js`, rota `POST /api/checkout` | Nova função `descobrirOrigemPublica(req)` calcula o domínio real a partir dos headers da requisição e monta a URL do webhook automaticamente. |

---

## Arquivos novos
- `api.js` — toda a lógica de rotas (antes estava dentro do `server.js`)
- `imageStorage.js` — módulo de upload de imagens (Cloudinary ou disco local)
- `netlify/functions/api.js` — entrada serverless para a Netlify
- `.env.example` — modelo de variáveis de ambiente

## Arquivos reescritos
- `server.js` — agora é só um "adaptador" fino, sem lógica de negócio
- `mercadopagoService.js` — mesma lógica, comentada e organizada
- `package.json` — dependências corrigidas
- `netlify.toml` — comentado, com `node_bundler` explícito
- `.gitignore` — passou a ignorar `uploads/` e qualquer `*.db`
- `DEPLOY_NETLIFY.md` — reescrito

## Não incluídos neste pacote (ação manual sua)
- Remover `app.js`, `produto-detalhes.css` e `banco.db` do repositório.
- Remover o arquivo `_redirects` (redundante com `netlify.toml`).
- Configurar as variáveis de ambiente reais no seu provedor de MySQL, no
  Cloudinary (se for usar) e na Netlify.

## Como rodar depois destas mudanças

```bash
npm install
cp .env.example .env   # preencha com seus dados reais
npm start
```

Nada mudou do ponto de vista do frontend — nenhuma página HTML/JS do
cliente precisou ser alterada. Todas as correções ficaram isoladas no
backend.
