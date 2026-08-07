# Implementacao desta rodada

## Arquivos alterados

- `api.js`: sessoes seguras, recuperacao de senha, login Google, checkout com entrega estruturada, pedido com frete, itens normalizados, analytics e dados completos na fila.
- `emailService.js`: envio de recuperacao por SMTP, com modo de teste seguro quando SMTP/nodemailer nao estiver configurado.
- `public/checkout.html`: formulario completo de entrega, validacao de CPF/CEP, envio de frete/origem e uso de cookie de sessao.
- `public/login.html`: link de recuperacao, login por cookie e preparacao para Google Login.
- `public/esqueci-senha.html` e `public/redefinir-senha.html`: telas de recuperacao de senha.
- `public/admin.js`: admin com cookie de sessao, logout no servidor e link para `Analise`.
- `public/admin-analise.html`: painel leve de analise de vendas.
- `public/admin-servicos.html`: fila com destinatario, CPF, telefone, endereco completo e variante.
- `public/analytics.js`: captura simples de UTM/referrer para pedidos.
- `package.json` e `package-lock.json`: dependencia `nodemailer`.

## Correcoes relacionadas aos erros informados

- Checkout agora soma produto + frete no backend antes de enviar ao Mercado Pago.
- Fila admin mostra a variante/modelo em cada item e tambem os dados de entrega estruturados.
- Erros de estoque agora retornam a mensagem real ao usuario, em vez de `Formato de requisicao invalido`.

## Ajustes manuais pendentes

- TODO ajuste manual: configurar SMTP real para os e-mails de recuperacao.
- TODO ajuste manual: configurar `GOOGLE_CLIENT_ID` no Google Cloud e na Netlify.
- TODO ajuste manual: trocar credenciais admin padrao antes de producao.
- TODO ajuste manual: revisar produtos com variante e estoque 0. Esses produtos continuam bloqueando pagamento corretamente ate o estoque ser ajustado no admin.
