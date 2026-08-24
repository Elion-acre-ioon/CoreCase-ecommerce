# Recibos Core Case

O Editor em **Financeiro > Recibos** usa um modelo estruturado. Não aceita JavaScript nem HTML arbitrário.

## Tags disponíveis

- `{{pedido.codigo}}`, `{{pedido.data}}`, `{{pedido.status}}`: identificação e estado do pedido.
- `{{cliente.nome}}`, `{{cliente.cpf}}`, `{{cliente.email}}`, `{{cliente.telefone}}`: cadastro do cliente.
- `{{endereco.cep}}`, `{{endereco.logradouro}}`, `{{endereco.numero}}`, `{{endereco.complemento}}`, `{{endereco.bairro}}`, `{{endereco.cidade}}`, `{{endereco.estado}}`: endereço estruturado do checkout.
- `{{pagamento.forma}}`, `{{pagamento.id}}`: forma e identificador do pagamento.
- `{{pedido.subtotal}}`, `{{pedido.frete}}`, `{{pedido.desconto}}`, `{{pedido.total}}`: valores confirmados do pedido.
- `{{itens.tabela}}`: todos os produtos, variantes, quantidades, valores unitários e totais.

Dados ausentes ficam em branco ou aparecem como “Não informado”; nunca são inventados. No modo automático, a origem é o pedido consultado no servidor. Os campos continuam editáveis antes da geração. No modo manual, o Admin informa os dados disponíveis.

Para adicionar uma tag, inclua-a na lista permitida de `prepararConfigRecibo`, mapeie a origem no gerador server-side e documente o fallback. A geração retorna PDF com o código do pedido no conteúdo e no nome do arquivo.
