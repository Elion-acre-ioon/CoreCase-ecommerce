# Core Case

Loja virtual com vitrine, carrinho, checkout Mercado Pago, painel administrativo, fila de pedidos, gestao de produtos/usuarios e analise de vendas.

## Como executar localmente

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha os dados do MySQL e Mercado Pago.

3. Inicie o servidor:

```bash
npm start
```

4. Acesse:

- Loja: `http://localhost:3000`
- Login: `http://localhost:3000/login.html`
- Admin emergencial: login `admin`, senha `System`

## Funcionalidades principais

- Login tradicional e sessoes seguras por cookie HttpOnly.
- Recuperacao de senha por e-mail.
- Login Google, quando `GOOGLE_CLIENT_ID` estiver configurado.
- Checkout com endereco de entrega completo, validacao de CPF/CEP e total recalculado no servidor.
- Frete somado ao total do pedido e salvo separadamente.
- Fila administrativa com variante do produto e dados completos de entrega.
- Aba `Analise` no admin com faturamento, pedidos, produtos, pagamentos e origem.
- Tags de produto na vitrine e na pagina de detalhes.

## Ajustes manuais

Veja `.env.example` e `SECURITY.md`. Os pontos mais importantes sao SMTP, Google Client ID, credenciais do Mercado Pago, Cloudinary e troca das credenciais admin padrao.
