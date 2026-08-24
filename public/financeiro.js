montarNavAdmin('financeiro');

async function carregarConfiguracao() {

    const resposta =
    await adminFetch('/api/configuracoes');

    const dados =
    await resposta.json();

    document.getElementById('public_key').value =
    dados.public_key || '';

    document.getElementById('access_token').value =
    dados.access_token || '';

    document.getElementById('chave_pix').value =
    dados.chave_pix || '';

    document.getElementById('nome_recebedor').value =
    dados.nome_recebedor || '';

    document.getElementById('ambiente').value =
    dados.ambiente || 'sandbox';

}

let pedidosRecibo = [];
let usuariosRecibo = [];
let produtosRecibo = [];

function escaparOpcaoRecibo(valor) {
    const div = document.createElement('div');
    div.textContent = valor == null ? '' : String(valor);
    return div.innerHTML;
}

function pedidoProcessadoRecibo(pedido) {
    const status = String(pedido.status || '').toLowerCase();
    return status.includes('aprovado') || status.includes('finalizado') || status.includes('entregue');
}

async function carregarRecibos() {
    const respostas = await Promise.all([
        adminFetch('/api/admin/recibos/config'), adminFetch('/api/pedidos'),
        adminFetch('/api/usuarios'), adminFetch('/api/produtos')
    ]);
    const [config, pedidos, usuarios, produtos] = await Promise.all(respostas.map(resposta => resposta.json()));
    pedidosRecibo = Array.isArray(pedidos) ? pedidos.filter(pedidoProcessadoRecibo) : [];
    usuariosRecibo = Array.isArray(usuarios) ? usuarios.filter(usuario => Number(usuario.ativo ?? 1) === 1) : [];
    produtosRecibo = Array.isArray(produtos) ? produtos : [];
    document.getElementById('reciboTitulo').value = config.titulo || '';
    document.getElementById('reciboLogo').value = config.logo_url || '';
    document.getElementById('reciboTexto').value = config.texto || '';
    document.getElementById('reciboObservacoes').value = config.observacoes || '';
    document.getElementById('reciboRodape').value = config.rodape || '';
    document.getElementById('reciboCampos').value = (config.campos || []).map(campo => `{{${campo}}}`).join('\n');
    document.getElementById('reciboPedido').innerHTML = '<option value="">Selecione</option>' + pedidosRecibo.map(pedido => `<option value="${Number(pedido.id)}">#${escaparOpcaoRecibo(pedido.codigo_pedido)} - ${escaparOpcaoRecibo(pedido.cliente_nome || 'Cliente')}</option>`).join('');
    document.getElementById('reciboClienteSelecionado').innerHTML = '<option value="">Selecione</option>' + usuariosRecibo.map(usuario => `<option value="${Number(usuario.id)}">${escaparOpcaoRecibo(usuario.nome)} - ${escaparOpcaoRecibo(usuario.email)}</option>`).join('');
    document.getElementById('reciboProdutoSelecionado').innerHTML = '<option value="">Selecione</option>' + produtosRecibo.map(produto => `<option value="${Number(produto.id)}">${escaparOpcaoRecibo(produto.nome)}</option>`).join('');
    document.getElementById('reciboPedido').addEventListener('change',preencherPedidoRecibo);
    document.getElementById('reciboClienteSelecionado').addEventListener('change', preencherClienteRecibo);
    document.getElementById('reciboProdutoSelecionado').addEventListener('change', adicionarProdutoRecibo);
    alternarModoRecibo();
}

async function salvarEditorRecibo(event) {
    event.preventDefault();
    const campos = document.getElementById('reciboCampos').value.split(/\r?\n/).map(valor => valor.trim().replace(/^\{\{|\}\}$/g, '')).filter(Boolean);
    const corpo = {
        titulo: document.getElementById('reciboTitulo').value,
        logo_url: document.getElementById('reciboLogo').value,
        texto: document.getElementById('reciboTexto').value,
        observacoes: document.getElementById('reciboObservacoes').value,
        rodape: document.getElementById('reciboRodape').value,
        campos
    };
    const resposta = await adminFetch('/api/admin/recibos/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo) });
    const resultado = await resposta.json();
    alert(resposta.ok ? 'Editor salvo.' : (resultado.erro || 'Não foi possível salvar.'));
}

function alternarModoRecibo() {
    const automatico = document.getElementById('reciboModo').value === 'automatico';
    document.getElementById('reciboPedidoGrupo').hidden = !automatico;
    document.getElementById('reciboSeletoresManuais').hidden = automatico;
    document.getElementById('reciboPedido').required = automatico;
}

function formatarItensRecibo(itens) {
    return (Array.isArray(itens) ? itens : []).map(item => [item.nome || 'Produto', item.variante || 'Padrão', Number(item.qtd || item.quantidade || 1), Number(item.preco || item.preco_unitario || 0).toFixed(2)].join(' | ')).join('\n');
}

function preencherPedidoRecibo() {
    const pedido = pedidosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboPedido').value));
    if (!pedido) return;
    document.getElementById('reciboCodigo').value = pedido.codigo_pedido || '';
    document.getElementById('reciboCliente').value = pedido.cliente_nome || '';
    document.getElementById('reciboCpf').value = pedido.cpf || '';
    document.getElementById('reciboEmail').value = pedido.email || '';
    document.getElementById('reciboTelefone').value = pedido.telefone || '';
    document.getElementById('reciboData').value = pedido.criado_em || '';
    document.getElementById('reciboStatus').value = pedido.status || '';
    document.getElementById('reciboPagamento').value = pedido.forma_pagamento || '';
    document.getElementById('reciboPagamentoId').value = pedido.mercadopago_id || '';
    document.getElementById('reciboCep').value = pedido.entrega_cep || pedido.cep || '';
    document.getElementById('reciboEndereco').value = [pedido.entrega_logradouro, pedido.entrega_numero, pedido.entrega_complemento, pedido.entrega_bairro, pedido.entrega_cidade, pedido.entrega_estado].filter(Boolean).join(' | ');
    document.getElementById('reciboSubtotal').value = pedido.subtotal || 0;
    document.getElementById('reciboFrete').value = pedido.valor_frete || 0;
    document.getElementById('reciboDesconto').value = pedido.desconto || 0;
    document.getElementById('reciboTotal').value = pedido.total || 0;
    document.getElementById('reciboItens').value = formatarItensRecibo(pedido.produtos);
}

function preencherClienteRecibo() {
    const usuario = usuariosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboClienteSelecionado').value));
    if (!usuario) return;
    document.getElementById('reciboCliente').value = usuario.nome || '';
    document.getElementById('reciboCpf').value = usuario.cpf || '';
    document.getElementById('reciboEmail').value = usuario.email || '';
    document.getElementById('reciboTelefone').value = usuario.telefone || '';
    document.getElementById('reciboCep').value = usuario.cep || '';
    document.getElementById('reciboEndereco').value = usuario.endereco || '';
}

function precoEfetivoProdutoRecibo(produto) {
    const preco = Number(produto.preco || 0);
    const promocional = Number(produto.preco_promocional || 0);
    return Boolean(produto.promocao_ativa) && promocional > 0 && promocional < preco ? promocional : preco;
}

function adicionarProdutoRecibo() {
    const produto = produtosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboProdutoSelecionado').value));
    if (!produto) return;
    const linha = formatarItensRecibo([{ nome:produto.nome, variante:'Padrão', qtd:1, preco:precoEfetivoProdutoRecibo(produto) }]);
    const campo = document.getElementById('reciboItens');
    campo.value = [campo.value.trim(), linha].filter(Boolean).join('\n');
    document.getElementById('reciboProdutoSelecionado').value = '';
}

function lerItensRecibo() {
    return document.getElementById('reciboItens').value.split(/\r?\n/).map(linha => {
        const [nome, variante, quantidade, preco] = linha.split('|').map(valor => String(valor || '').trim());
        return { nome, variante: variante || 'Padrão', qtd: Math.max(1, Number(quantidade) || 1), preco: Math.max(0, Number(String(preco || '0').replace(',', '.')) || 0) };
    }).filter(item => item.nome);
}

function lerEnderecoRecibo() {
    const [logradouro, numero, complemento, bairro, cidade, estado] = document.getElementById('reciboEndereco').value.split('|').map(valor => String(valor || '').trim());
    return { cep:document.getElementById('reciboCep').value, logradouro, numero, complemento, bairro, cidade, estado };
}

async function gerarRecibo(event) {
    event.preventDefault();
    const automatico = document.getElementById('reciboModo').value === 'automatico';
    const corpo = {
        pedido_id: automatico ? Number(document.getElementById('reciboPedido').value) || null : null,
        dados: {
            pedido: {
                codigo:document.getElementById('reciboCodigo').value, data:document.getElementById('reciboData').value,
                status:document.getElementById('reciboStatus').value, subtotal:Number(document.getElementById('reciboSubtotal').value) || 0,
                frete:Number(document.getElementById('reciboFrete').value) || 0, desconto:Number(document.getElementById('reciboDesconto').value) || 0,
                total:Number(document.getElementById('reciboTotal').value) || 0
            },
            cliente:{ nome:document.getElementById('reciboCliente').value, cpf:document.getElementById('reciboCpf').value, email:document.getElementById('reciboEmail').value, telefone:document.getElementById('reciboTelefone').value },
            endereco:lerEnderecoRecibo(),
            pagamento:{ forma:document.getElementById('reciboPagamento').value, id:document.getElementById('reciboPagamentoId').value },
            itens:lerItensRecibo()
        }
    };
    const resposta = await adminFetch('/api/admin/recibos/pdf', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo) });
    if (!resposta.ok) return alert((await resposta.json()).erro || 'Falha ao gerar.');
    const blob = await resposta.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `recibo-core-case-${document.getElementById('reciboCodigo').value || 'manual'}.pdf`;
    link.click();
    URL.revokeObjectURL(link.href);
}

async function salvarConfiguracao(event){

    event.preventDefault();

    const dados = {

        public_key:
        document.getElementById('public_key').value,

        access_token:
        document.getElementById('access_token').value,

        chave_pix:
        document.getElementById('chave_pix').value,

        nome_recebedor:
        document.getElementById('nome_recebedor').value,

        ambiente:
        document.getElementById('ambiente').value

    };

    const resposta =
    await adminFetch('/api/configuracoes',{

        method:'PUT',

        headers:{
            'Content-Type':'application/json'
        },

        body:JSON.stringify(dados)

    });

    const resultado =
    await resposta.json();

    if(resultado.sucesso){

        alert(
        'Configurações salvas com sucesso.'
        );

    }else{

        alert(
        'Erro ao salvar.'
        );

    }

}

carregarConfiguracao();
carregarRecibos();
