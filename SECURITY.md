# Seguranca

## O que foi implementado

- Senhas novas e redefinidas usam hash PBKDF2.
- Logins de usuarios do banco criam sessao em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em producao.
- Logout revoga a sessao no banco.
- Redefinicao de senha usa token aleatorio, armazenado apenas como hash, com expiracao e uso unico.
- Rotas sensiveis de usuario aceitam a sessao segura e mantem o token legado apenas para compatibilidade.
- Rotas administrativas aceitam administradores promovidos no banco via sessao segura.
- Checkout valida endereco de entrega no servidor e recalcula subtotal, frete e total sem confiar no navegador.

## Pontos manuais obrigatorios

- Confirmar que `ADMIN_TOKEN`, `ADMIN_USER`, `ADMIN_SENHA` e `SESSION_SECRET` continuam cadastrados na hospedagem. Esta correcao nao troca credenciais administrativas.
- Confirmar `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` e `EMAIL_TEST_MODE=false` na hospedagem para envio real de recuperacao de senha.
- Confirmar `GOOGLE_CLIENT_ID` na hospedagem.
- Usar `/api/admin/diagnostico` para validar banco, Google, SMTP e `APP_BASE_URL` sem expor segredos.

## Observacao

O projeto ainda mantem `localStorage` com dados basicos do usuario para compatibilidade com as telas existentes. A protecao real das rotas novas vem do cookie HttpOnly e das validacoes no servidor.
