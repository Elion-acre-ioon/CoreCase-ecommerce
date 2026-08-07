# Migracoes do banco

As migracoes foram adicionadas de forma segura dentro de `api.js`: ao iniciar o servidor, ele cria tabelas novas e tenta adicionar colunas ausentes sem apagar dados existentes.

## Novas tabelas

- `sessoes`: sessoes HttpOnly por usuario, com expiracao e revogacao.
- `recuperacoes_senha`: tokens de redefinicao de senha com uso unico e validade.
- `identidades_usuario`: vinculo entre usuarios locais e login Google.
- `pedido_itens`: itens normalizados do pedido, incluindo variante, quantidade, preco e frete.
- `pedido_enderecos`: endereco de entrega estruturado informado no checkout.

## Novas colunas

- `usuarios.sessao_versao`
- `pedidos.criado_em`, `pago_em`, `enviado_em`, `entregue_em`, `cancelado_em`
- `pedidos.subtotal`, `valor_frete`, `desconto`, `taxa_pagamento`
- `pedidos.origem`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`

## Ajuste manual recomendado

Antes de publicar em producao, faca backup do MySQL e rode o site uma vez em ambiente de homologacao para confirmar que as tabelas foram criadas. Depois confira no banco se `pedido_itens` e `pedido_enderecos` estao recebendo registros em novos pedidos.
