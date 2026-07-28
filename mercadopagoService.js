/* ============================================================================
 * MÓDULO: mercadopagoService.js
 * ----------------------------------------------------------------------------
 * Isola toda a comunicação com a API do Mercado Pago. Ninguém fora deste
 * arquivo deveria precisar saber como o Mercado Pago é chamado — o resto do
 * sistema só chama `criarPagamento(...)` e recebe a resposta pronta.
 * ============================================================================ */

const { MercadoPagoConfig, Payment } = require('mercadopago');

/* ----------------------------------------------------------------------------
 * Busca as credenciais ativas na tabela `configuracoes` (preenchidas pelo
 * admin em admin-financeiro.html) e inicializa o cliente do Mercado Pago.
 * ---------------------------------------------------------------------------- */
async function inicializarMercadoPago(db) {
    const [rows] = await db.execute('SELECT access_token FROM configuracoes LIMIT 1');
    const config = rows[0];

    if (!config || !config.access_token) {
        throw new Error('Access Token do Mercado Pago não encontrado. Configure em Admin > Financeiro.');
    }

    const client = new MercadoPagoConfig({
        accessToken: config.access_token,
        options: { timeout: 5000 }
    });

    return new Payment(client);
}

/* ----------------------------------------------------------------------------
 * Processa a requisição de pagamento (Pix ou Cartão) junto ao Mercado Pago.
 *
 * CORREÇÃO (seção 11 da documentação — "corrigir notification_url"):
 * este serviço sempre aceitou `dadosPedido.notificationUrl` vindo de fora,
 * mas o backend nunca preenchia esse campo automaticamente, então caía
 * sempre no valor de exemplo "https://seu-dominio.com/api/webhook".
 * Agora o `api.js` calcula a URL real do domínio a partir da própria
 * requisição HTTP e sempre envia esse valor — então o fallback abaixo só
 * é usado em último caso (ex: chamada manual ao serviço sem esse dado).
 * ---------------------------------------------------------------------------- */
async function criarPagamento(db, dadosPedido, codigoPedido) {
    const payment = await inicializarMercadoPago(db);

    const paymentData = {
        body: {
            transaction_amount: Number(dadosPedido.total || 0),
            description: `Pedido #${codigoPedido} - CoreCase`,
            payment_method_id: dadosPedido.tipoPagamentoMP === 'pix' ? 'pix' : dadosPedido.paymentMethodId,
            payer: {
                email: dadosPedido.email || 'comprador@email.com',
                first_name: dadosPedido.nomeRecebedor.split(' ')[0] || 'Cliente',
                last_name: dadosPedido.nomeRecebedor.split(' ').slice(1).join(' ') || 'Silva',
                identification: {
                    type: 'CPF',
                    number: dadosPedido.cpf ? dadosPedido.cpf.replace(/\D/g, '') : '00000000000'
                }
            },
            // URL que o Mercado Pago chama quando o status do pagamento muda.
            // Ver comentário acima: hoje isso vem calculado dinamicamente do api.js.
            notification_url: dadosPedido.notificationUrl || 'https://seu-dominio.com/api/webhook'
        }
    };

    // Campos extras exigidos apenas quando o pagamento é via cartão de crédito
    if (dadosPedido.tipoPagamentoMP === 'cartao') {
        if (!dadosPedido.token) {
            throw new Error('Token do cartão é obrigatório para pagamentos via crédito.');
        }
        paymentData.body.token = dadosPedido.token;
        paymentData.body.installments = Number(dadosPedido.installments || 1);
    }

    return payment.create(paymentData);
}

module.exports = {
    criarPagamento,
    inicializarMercadoPago
};
