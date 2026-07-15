let todosProdutos = [];
let carrinho = [];

// Carrega os produtos vindos do Back-end ao abrir a página
window.onload = async () => {
    try {
        const resposta = await fetch('http://localhost:3000/api/produtos');
        todosProdutos = await resposta.json();
        renderizarProdutos(todosProdutos);
        atualizarPainelAdmin();
    } catch (erro) {
        console.error("Erro ao conectar com o back-end:", erro);
    }
};

function renderizarProdutos(lista) {
    const vitrine = document.getElementById('vitrine');
    vitrine.innerHTML = '';
    lista.forEach(p => {
        vitrine.innerHTML += `
            <div class="card-produto">
                <img src="${p.imagem}" alt="${p.nome}">
                <h4>${p.nome}</h4>
                <p>Categoria: ${p.categoria}</p>
                <p><strong>R$ ${p.preco.toFixed(2)}</strong></p>
                <button onclick="adicionarAoCarrinho(${p.id})">Adicionar</button>
            </div>
        `;
    });
}

function filtrarProdutos() {
    const termo = document.getElementById('inputBusca').value.toLowerCase();
    const filtrados = todosProdutos.filter(p => p.nome.toLowerCase().includes(termo));
    renderizarProdutos(filtrados);
}

function adicionarAoCarrinho(id) {
    const produto = todosProdutos.find(p => p.id === id);
    carrinho.push(produto);
    
    // GA4: Disparar evento de produto adicionado ao carrinho
    if(typeof gtag === 'function') {
        gtag('event', 'add_to_cart', { items: [{ item_id: produto.id, item_name: produto.nome, price: produto.preco }] });
    }
    
    atualizarCarrinho();
}

function atualizarCarrinho() {
    const container = document.getElementById('itensCarrinho');
    const txtTotal = document.getElementById('valorTotal');
    
    if (carrinho.length === 0) {
        container.innerHTML = "O carrinho está vazio.";
        txtTotal.innerText = "0,00";
        return;
    }
    
    container.innerHTML = carrinho.map((p, index) => `<div>${p.nome} - R$ ${p.preco.toFixed(2)}</div>`).join('');
    const total = carrinho.reduce((soma, p) => soma + p.preco, 0);
    txtTotal.innerText = total.toFixed(2);
}

async function finalizarCompra() {
    const form = document.getElementById('formCadastro');
    if (!form.checkValidity()) {
        alert("Por favor, preencha todos os dados do cadastro antes de pagar!");
        return;
    }

    if (carrinho.length === 0) {
        alert("Seu carrinho está vazio!");
        return;
    }

    const cliente = {
        nome: document.getElementById('cadNome').value,
        cpf: document.getElementById('cadCpf').value,
        cep: document.getElementById('cadCep').value,
        endereco: document.getElementById('cadEndereco').value,
        telefone: document.getElementById('cadTelefone').value,
        email: document.getElementById('cadEmail').value
    };

    const total = carrinho.reduce((sum, p) => sum + p.preco, 0);
    const formaPagamento = document.getElementById('metodoPagamento').value;

    const dadosEnvio = { cliente, produtos: carrinho, total, formaPagamento };

    // Envia dados para o servidor processar o pagamento fictício
    const resposta = await fetch('http://localhost:3000/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosEnvio)
    });

    const resultado = await resposta.json();

    if (resultado.sucesso) {
        alert(`${resultado.mensagem}\nCódigo do Pedido: ${resultado.pedido.codigo}`);
        
        // GA4: Disparar evento de transação concluída com sucesso
        if(typeof gtag === 'function') {
            gtag('event', 'purchase', { transaction_id: resultado.pedido.codigo, value: total, currency: 'BRL' });
        }

        // Limpa o carrinho
        carrinho = [];
        atualizarCarrinho();
        form.reset();
        
        // Atualiza a visualização do administrador lá embaixo
        atualizarPainelAdmin();
    }
}

// Lógica da Aba do Administrador (Processamento dos Pedidos)
async function atualizarPainelAdmin() {
    const divPainel = document.getElementById('listaPedidosProcessamento');
    const resposta = await fetch('http://localhost:3000/api/pedidos');
    const pedidos = await resposta.json();

    if (pedidos.length === 0) {
        divPainel.innerHTML = "<p>Nenhum pedido recebido em processamento ainda.</p>";
        return;
    }

    divPainel.innerHTML = pedidos.map(p => `
        <div class="card-processamento">
            <strong style="cursor:pointer; color:#2563eb;" onclick="alternarDetalhes(${p.codigo})">
                📦 Pedido #${p.codigo} - Cliente: ${p.cliente.nome} | Status: <span style="color:orange">${p.status}</span> (Clique para abrir)
            </strong>
            
            <div id="detalhe-${p.codigo}" class="detalhes-pedido">
                <p><strong>Dados do Cadastro:</strong> CPF: ${p.cliente.cpf} | Tel: ${p.cliente.telefone} | E-mail: ${p.cliente.email}</p>
                <p><strong>Endereço de Entrega:</strong> ${p.cliente.endereco} - CEP: ${p.cliente.cep}</p>
                <p><strong>Forma de Recebimento Utilizada:</strong> ${p.formaPagamento} (Saldo em Conta Corrente)</p>
                <p><strong>Produtos Solicitados:</strong></p>
                <ul>
                    ${p.produtos.map(prod => `<li>${prod.nome} - R$ ${prod.preco.toFixed(2)}</li>`).join('')}
                </ul>
                <p><strong>Valor Total Líquido Depositado:</strong> R$ ${p.total.toFixed(2)}</p>
                
                ${p.status === "Em Processamento" ? 
                    `<button class="btn-finalizar" onclick="finalizarEntrega(${p.codigo})">✓ Confirmar Chegada na Casa do Cliente (Finalizar Check-out)</button>` 
                    : `<b style="color:green">✓ Transação Concluída e Arquivada</b>`}
            </div>
        </div>
    `).join('');
}

function alternarDetalhes(codigo) {
    const el = document.getElementById(`detalhe-${codigo}`);
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

async function finalizarEntrega(codigo) {
    const resposta = await fetch(`http://localhost:3000/api/pedidos/finalizar/${codigo}`, {
        method: 'PUT'
    });
    const resultado = await resposta.json();
    if(resultado.sucesso) {
        alert(`Pedido #${codigo} marcado como entregue com sucesso! Processo finalizado.`);
        atualizarPainelAdmin();
    }
}