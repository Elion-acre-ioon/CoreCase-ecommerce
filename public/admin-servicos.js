montarNavAdmin('fila');

let pedidosFila = [];
let filtroFila = 'todos';

function escaparFila(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, caractere => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[caractere]));
}

function nomeVarianteProduto(produto) {
    if (!produto || !produto.variante) return 'Padrão';
    if (typeof produto.variante === 'object') return produto.variante.nome || 'Padrão';
    return String(produto.variante);
}

function produtosPedidoHtml(pedido) {
    const produtos = Array.isArray(pedido.produtos) ? pedido.produtos : [];
    return produtos.length ? produtos.map(produto => {
        const qtd = Math.max(1, Number(produto.qtd || 1));
        const preco = Number(produto.preco || 0);
        const frete = Number(produto.frete || 0);
        return `<li><strong>${escaparFila(produto.nome || 'Produto')}</strong> · ${escaparFila(nomeVarianteProduto(produto))} · ${qtd} un. · R$ ${moeda(preco * qtd)}${frete > 0 ? ` + frete R$ ${moeda(frete * qtd)}` : ''}</li>`;
    }).join('') : '<li>Nenhum produto registrado.</li>';
}

function enderecoEntregaPedido(pedido) {
    if (!pedido.entrega_logradouro) return pedido.endereco_envio || '-';
    const complemento = pedido.entrega_complemento ? `, ${pedido.entrega_complemento}` : '';
    return `${pedido.entrega_logradouro}, ${pedido.entrega_numero || 's/n'}${complemento} - ${pedido.entrega_bairro || '-'}, ${pedido.entrega_cidade || '-'}/${pedido.entrega_estado || '-'}, CEP ${pedido.entrega_cep || '-'}`;
}

function cardPedidoFila(pedido) {
    const finalizado = String(pedido.status || '').toLowerCase().includes('finalizado') || String(pedido.status || '').toLowerCase().includes('entregue');
    return `<article class="fila-card pedido" id="pedido-fila-${Number(pedido.id)}">
        <div class="fila-card-topo"><div><span class="fila-tipo">&gt; PEDIDO</span><h3>Pedido #${escaparFila(pedido.codigo_pedido)}</h3><span class="status-pill ${finalizado ? 'finalizado' : ''}">${escaparFila(pedido.status || '-')}</span></div><strong>Total: R$ ${moeda(pedido.total)}</strong></div>
        <div class="fila-dados"><p><strong>Comprador:</strong> ${escaparFila(pedido.cliente_nome || 'Usuário removido')} · CPF ${escaparFila(pedido.cpf || '-')} · ${escaparFila(pedido.telefone || '-')} · ${escaparFila(pedido.email || '-')}</p><p><strong>Destinatário:</strong> ${escaparFila(pedido.entrega_nome || pedido.nome_recebedor || '-')}</p><p><strong>Endereço:</strong> ${escaparFila(enderecoEntregaPedido(pedido))}</p><p><strong>Pagamento:</strong> ${escaparFila(pedido.forma_pagamento || '-')}</p></div>
        <ul class="fila-itens">${produtosPedidoHtml(pedido)}</ul>
        ${finalizado ? '<strong class="fila-sucesso">Entrega confirmada.</strong>' : `<button class="btn-sucesso btn-pequeno" onclick="darBaixaEntrega(${Number(pedido.id)})">Confirmar entrega</button>`}
    </article>`;
}

function dataFila(valor) {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 'Não informado' : data.toLocaleString('pt-BR');
}

function cardReembolsoFila(pedido) {
    return `<article class="fila-card reembolso">
        <div class="fila-card-topo"><div><span class="fila-tipo">↩ SOLICITAÇÃO DE REEMBOLSO</span><h3>Pedido #${escaparFila(pedido.codigo_pedido)}</h3><span class="status-pill reembolso">${escaparFila(pedido.reembolso_status)}</span></div><strong>Total: R$ ${moeda(pedido.total)}</strong></div>
        <p><strong>Cliente:</strong> ${escaparFila(pedido.cliente_nome || 'Usuário removido')}</p><p><strong>Solicitado em:</strong> ${escaparFila(dataFila(pedido.reembolso_solicitado_em))}</p>
        <p><strong>Produtos do pedido:</strong></p><ul class="fila-itens">${produtosPedidoHtml(pedido)}</ul>
        <button class="btn-neutro btn-pequeno" onclick="verPedidoFila(${Number(pedido.id)})">Ver pedido</button>
    </article>`;
}

function renderizarFila() {
    const container = document.getElementById('fila');
    const reembolsos = pedidosFila.filter(pedido => pedido.reembolso_status);
    const pendentes = reembolsos.filter(pedido => !['concluido','concluído','recusado'].includes(String(pedido.reembolso_status).toLowerCase())).length;
    document.getElementById('contadorReembolsos').textContent = `Reembolsos pendentes: ${pendentes}`;
    const blocos = [];
    if (filtroFila !== 'reembolsos') blocos.push(`<section class="fila-grupo"><h3 class="fila-grupo-titulo">Pedidos (${pedidosFila.length})</h3>${pedidosFila.map(cardPedidoFila).join('') || '<p class="muted">Nenhum pedido recebido ainda.</p>'}</section>`);
    if (filtroFila !== 'pedidos') blocos.push(`<section class="fila-grupo"><h3 class="fila-grupo-titulo">Solicitações de reembolso (${reembolsos.length})</h3>${reembolsos.map(cardReembolsoFila).join('') || '<p class="muted">Nenhuma solicitação de reembolso.</p>'}</section>`);
    container.innerHTML = blocos.join('');
}

function filtrarFila(filtro) {
    filtroFila = filtro;
    document.querySelectorAll('[data-filtro-fila]').forEach(botao => botao.classList.toggle('active', botao.dataset.filtroFila === filtro));
    renderizarFila();
}

function verPedidoFila(id) {
    if (filtroFila === 'reembolsos') filtrarFila('todos');
    window.requestAnimationFrame(() => document.getElementById(`pedido-fila-${id}`)?.scrollIntoView({ behavior:'smooth', block:'center' }));
}

async function darBaixaEntrega(id) {
    await adminFetch(`/api/pedidos/finalizar/${id}`, { method:'PUT' });
    await carregarFila();
}

async function carregarFila() {
    const resposta = await adminFetch('/api/pedidos');
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível carregar a fila.');
    pedidosFila = Array.isArray(dados) ? dados : [];
    renderizarFila();
}

document.querySelectorAll('[data-filtro-fila]').forEach(botao => botao.addEventListener('click', () => filtrarFila(botao.dataset.filtroFila)));
carregarFila().catch(erro => { document.getElementById('fila').innerHTML = `<p class="muted">${escaparFila(erro.message)}</p>`; });
