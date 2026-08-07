# Implementacao desta rodada

## Arquivos alterados

- `api.js`: refatoracao das migrations, logs por etapa, rota `/api/admin/diagnostico`, login antigo com erro de infraestrutura separado, recuperacao de senha com logs por stage, login Google com `google-auth-library`, analytics com logs e backfill seguro.
- `emailService.js`: verificacao SMTP sob demanda e texto de recuperacao usando `RESET_PASSWORD_TTL_MINUTES`.
- `public/login.html`: Google Identity Services inicializado uma unica vez.
- `package.json` e `package-lock.json`: dependencia `google-auth-library`.
- `MIGRATIONS.md` e `SECURITY.md`: documentacao dos novos diagnosticos.

## Correcoes relacionadas aos erros informados

- `recuperacoes_senha` ausente em producao: migrations agora sao aguardadas, independentes e verificadas ao final.
- Login antigo: se a senha estiver correta mas `sessoes` falhar, a API retorna 503 e loga `[auth:login] ERRO stage=session_create`.
- Login Google: erros de credential, identidade, usuario e sessao agora aparecem com `[auth:google] falha stage=...`.
- Analytics: nao depende de GA4; usa MySQL, verifica estrutura e faz backfill idempotente de `pedido_itens` para pedidos antigos.

## Confirmacoes manuais apos deploy

- Confirmar na Netlify: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TEST_MODE=false`.
- Confirmar na Netlify: `GOOGLE_CLIENT_ID`.
- Confirmar na Netlify: `APP_BASE_URL`.
- Abrir `/api/admin/diagnostico` autenticado como admin e verificar se banco, Google e SMTP estao marcados como disponiveis.
