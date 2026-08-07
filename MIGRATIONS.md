# Migracoes do banco

As migracoes ficam dentro de `api.js` e agora sao aguardadas antes das rotas `/api` usarem o MySQL. Elas rodam uma vez por cold start da Netlify Function, sao idempotentes e nao apagam dados existentes.

## Novas tabelas

- `sessoes`: sessoes HttpOnly por usuario, com expiracao e revogacao.
- `recuperacoes_senha`: tokens de redefinicao de senha com uso unico e validade.
- `identidades_usuario`: vinculo entre usuarios locais e login Google.
- `pedido_itens`: itens normalizados do pedido, incluindo variante, quantidade, preco e frete.
- `pedido_enderecos`: endereco de entrega estruturado informado no checkout.
- `categorias`: categorias administraveis para loja e futura vitrine.

## Novas colunas

- `usuarios.sessao_versao`
- `pedidos.criado_em`, `pago_em`, `enviado_em`, `entregue_em`, `cancelado_em`
- `pedidos.subtotal`, `valor_frete`, `desconto`, `taxa_pagamento`
- `pedidos.origem`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`
- `produtos.categoria_id`

## Ajuste manual recomendado

Antes do proximo deploy, faca backup do MySQL. Depois do deploy, abra `/api/admin/diagnostico` autenticado como admin e confira se as tabelas e colunas aparecem como `true`.

## Logs esperados na Netlify

- `[db:migration] usuarios: OK`
- `[db:migration] sessoes: OK`
- `[db:migration] recuperacoes_senha: OK`
- `[db:migration] identidades_usuario: OK`
- `[db:migration] pedido_itens: OK`
- `[db:migration] pedido_enderecos: OK`
- `[db:migration] categorias: OK`
- `[db:migration] produtos.categoria_id: OK`
- `[db:migration] banco pronto`

Se alguma etapa falhar, o log deve mostrar `[db:migration] <nome>: FALHOU` com `code`, `errno`, `sqlState` e `message`, sem dados de clientes.

## Backfill seguro

Pedidos antigos que tinham apenas `produtos_json` recebem registros em `pedido_itens` apenas se ainda nao houver itens normalizados para aquele pedido. A migration nao duplica itens e registra apenas contadores.
