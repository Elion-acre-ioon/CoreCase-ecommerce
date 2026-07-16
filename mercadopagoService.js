const { MercadoPagoConfig, Payment } = require('mercadopago');

/**
 * Busca as credenciais ativas na tabela 'configuracoes' e inicializa a API do Mercado Pago
 * @param {object} db - Instância do banco de dados SQLite
 * @returns {Promise<Payment>} Instância configurada para chamadas de pagamento
 */
function inicializarMercadoPago(db) {
    return new Promise((resolve, reject) => {
        db.get('SELECT access_token FROM configuracoes LIMIT 1', [], (err, config) => {
            if (err) return reject(new Error('Erro ao consultar a tabela de configurações.'));
            if (!config || !config.access_token) {
                return reject(new Error('Access Token do Mercado Pago não encontrado no banco de dados.'));
            }

            try {
                // Inicializa a SDK com a versão v3.x.x instalada no seu package.json
                const client = new MercadoPagoConfig({ 
                    accessToken: config.access_token,
                    options: { timeout: 5000 }
                });
                const paymentInstance = new Payment(client);
                resolve(paymentInstance);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Processa a requisição de pagamento (PIX ou Cartão) junto ao Mercado Pago
 */
async function criarPagamento(db, dadosPedido, codigoPedido) {
    const payment = await inicializarMercadoPago(db);

    const paymentData = {
        body: {
            transaction_amount: Number(dadosPedido.total || 0),
            description: `Pedido #${codigoPedido} - CoreCase`,
            payment_method_id: dadosPedido.formaPagamento === 'pix' ? 'pix' : dadosPedido.paymentMethodId,
            payer: {
                email: dadosPedido.email || 'comprador@email.com',
                first_name: dadosPedido.nomeRecebedor.split(' ')[0] || 'Cliente',
                last_name: dadosPedido.nomeRecebedor.split(' ').slice(1).join(' ') || 'Silva',
                identification: {
                    type: 'CPF',
                    number: dadosPedido.cpf ? dadosPedido.cpf.replace(/\D/g, '') : '00000000000'
                }
            },
            // IMPORTANTE: URL pública que o Mercado Pago vai notificar quando o PIX for pago
            notification_url: dadosPedido.notificationUrl || "https://seu-dominio.com/api/webhook"
        }
    };

    // Configurações específicas para Cartão de Crédito
    if (dadosPedido.formaPagamento === 'cartao') {
        if (!dadosPedido.token) throw new Error('Token do cartão é obrigatório para pagamentos via crédito.');
        paymentData.body.token = dadosPedido.token;
        paymentData.body.installments = Number(dadosPedido.installments || 1);
    }

    // Executa a chamada na API do Mercado Pago
    return await payment.create(paymentData);
}

module.exports = {
    criarPagamento,
    inicializarMercadoPago
};