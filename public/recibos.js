montarNavAdmin('recibos');

const TAGS_RECIBO = [
    ['pedido.codigo','Código do pedido','1042'], ['pedido.data','Data do pedido','24/08/2026 14:35'], ['pedido.status','Status atual','Finalizado'],
    ['cliente.nome','Nome completo do comprador','João Silva'], ['cliente.cpf','CPF do comprador','123.456.789-00'], ['cliente.email','E-mail do comprador','joao@exemplo.com'], ['cliente.telefone','Telefone do comprador','(11) 99999-0000'],
    ['endereco.cep','CEP de entrega','01000-000'], ['endereco.logradouro','Logradouro','Rua Exemplo'], ['endereco.numero','Número','104'], ['endereco.complemento','Complemento','Apto 12'], ['endereco.bairro','Bairro','Centro'], ['endereco.cidade','Cidade','São Paulo'], ['endereco.estado','Estado','SP'],
    ['pagamento.forma','Forma de pagamento','Crédito'], ['pagamento.id','Identificador do pagamento','MP-123456'],
    ['pedido.subtotal','Subtotal em BRL','R$ 199,90'], ['pedido.frete','Frete em BRL','R$ 15,00'], ['pedido.desconto','Desconto em BRL','R$ 10,00'], ['pedido.total','Total em BRL','R$ 204,90'],
    ['itens.tabela','Tabela com todos os itens','Produto, versão, qtd. e valores']
];

const AMOSTRA_RECIBO = Object.fromEntries(TAGS_RECIBO.map(([tag,,exemplo]) => [tag, exemplo]));
let pedidosRecibo = [];
let usuariosRecibo = [];
let produtosRecibo = [];
let timerPreviewRecibo = null;

function escaparOpcaoRecibo(valor) {
    const div = document.createElement('div');
    div.textContent = valor == null ? '' : String(valor);
    return div.innerHTML;
}

function pedidoProcessadoRecibo(pedido) {
    const status = String(pedido.status || '').toLowerCase();
    return status.includes('aprovado') || status.includes('finalizado') || status.includes('entregue');
}

function configurarAbasRecibo() {
    document.querySelectorAll('[data-recibo-tab]').forEach(botao => botao.addEventListener('click', () => {
        const editor = botao.dataset.reciboTab === 'editor';
        document.getElementById('painelEditorRecibo').hidden = !editor;
        document.getElementById('painelGeradorRecibo').hidden = editor;
        document.querySelectorAll('[data-recibo-tab]').forEach(item => {
            const ativo = item === botao;
            item.classList.toggle('active', ativo);
            item.setAttribute('aria-selected', String(ativo));
        });
    }));
}

function renderizarListaTagsRecibo() {
    const lista = document.getElementById('reciboTags');
    const fragmento = document.createDocumentFragment();
    TAGS_RECIBO.forEach(([tag, descricao, exemplo]) => {
        const item = document.createElement('div'); item.className = 'recibo-tag-item';
        const codigo = document.createElement('code'); codigo.textContent = `{{${tag}}}`;
        const texto = document.createElement('span'); texto.textContent = descricao;
        const exemploTag = document.createElement('span'); exemploTag.className = 'recibo-tag-exemplo'; exemploTag.textContent = exemplo;
        const copiar = document.createElement('button'); copiar.type = 'button'; copiar.className = 'btn-neutro'; copiar.textContent = 'Copiar'; copiar.setAttribute('aria-label', `Copiar tag ${tag}`);
        copiar.addEventListener('click', async () => {
            const valor = `{{${tag}}}`;
            try { await navigator.clipboard.writeText(valor); }
            catch (e) {
                const area = document.createElement('textarea'); area.value = valor; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
            }
            copiar.textContent = 'Copiado'; window.setTimeout(() => { copiar.textContent = 'Copiar'; }, 1200);
        });
        item.append(codigo, texto, exemploTag, copiar); fragmento.appendChild(item);
    });
    lista.replaceChildren(fragmento);
}

function substituirTagsPreview(texto) {
    return String(texto || '').replace(/\{\{([a-z]+\.[a-z_]+)\}\}/gi, (original, tag) => AMOSTRA_RECIBO[tag] || original);
}

function camposEditorRecibo() {
    return document.getElementById('reciboCampos').value.split(/\r?\n/).map(valor => valor.trim().replace(/^\{\{|\}\}$/g, '')).filter(tag => TAGS_RECIBO.some(([permitida]) => permitida === tag));
}

function adicionarTabelaPreview(alvo) {
    const tabela = document.createElement('table');
    const cabecalho = document.createElement('tr');
    ['Produto','Variante','Qtd.','Unitário','Total'].forEach(rotulo => { const th = document.createElement('th'); th.textContent = rotulo; cabecalho.appendChild(th); });
    const corpo = document.createElement('tbody');
    [['Capa Premium','Preta','2','R$ 49,95','R$ 99,90'],['Projetor Portátil','Branco','1','R$ 105,00','R$ 105,00']].forEach(valores => {
        const linha = document.createElement('tr'); valores.forEach(valor => { const td = document.createElement('td'); td.textContent = valor; linha.appendChild(td); }); corpo.appendChild(linha);
    });
    tabela.append(cabecalho, corpo); alvo.appendChild(tabela);
}

function atualizarPreviewRecibo() {
    const alvo = document.getElementById('reciboPreview');
    const fragmento = document.createDocumentFragment();
    const logo = String(document.getElementById('reciboLogo').value || '');
    if (/^https:\/\/res\.cloudinary\.com\//i.test(logo)) {
        const imagem = document.createElement('img'); imagem.className = 'preview-logo'; imagem.src = logo; imagem.alt = 'Logo do recibo'; imagem.addEventListener('error', () => imagem.remove()); fragmento.appendChild(imagem);
    }
    const titulo = document.createElement('h2'); titulo.textContent = document.getElementById('reciboTitulo').value || 'Recibo Core Case'; fragmento.appendChild(titulo);
    const codigo = document.createElement('p'); codigo.textContent = 'Pedido: 1042'; fragmento.appendChild(codigo);
    const texto = document.getElementById('reciboTexto').value;
    if (texto) { const intro = document.createElement('p'); intro.className = 'preview-intro'; intro.textContent = substituirTagsPreview(texto); fragmento.appendChild(intro); }
    camposEditorRecibo().forEach(tag => {
        if (tag === 'itens.tabela') return adicionarTabelaPreview(fragmento);
        const definicao = TAGS_RECIBO.find(([chave]) => chave === tag);
        if (!definicao) return;
        const linha = document.createElement('p'); linha.className = 'preview-campo';
        const rotulo = document.createElement('strong'); rotulo.textContent = definicao[1];
        const valor = document.createElement('span'); valor.textContent = AMOSTRA_RECIBO[tag] || 'Não informado'; linha.append(rotulo, valor); fragmento.appendChild(linha);
    });
    const observacoes = document.getElementById('reciboObservacoes').value;
    if (observacoes) { const nota = document.createElement('p'); nota.className = 'preview-observacoes'; nota.textContent = substituirTagsPreview(observacoes); fragmento.appendChild(nota); }
    const rodape = document.createElement('footer'); rodape.textContent = substituirTagsPreview(document.getElementById('reciboRodape').value || 'Core Case'); fragmento.appendChild(rodape);
    alvo.replaceChildren(fragmento);
}

function agendarPreviewRecibo() {
    window.clearTimeout(timerPreviewRecibo);
    timerPreviewRecibo = window.setTimeout(atualizarPreviewRecibo, 120);
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
    document.getElementById('reciboPedido').addEventListener('change', preencherPedidoRecibo);
    document.getElementById('reciboClienteSelecionado').addEventListener('change', preencherClienteRecibo);
    document.getElementById('reciboProdutoSelecionado').addEventListener('change', adicionarProdutoRecibo);
    ['reciboTitulo','reciboLogo','reciboTexto','reciboObservacoes','reciboRodape','reciboCampos'].forEach(id => document.getElementById(id).addEventListener('input', agendarPreviewRecibo));
    alternarModoRecibo(); atualizarPreviewRecibo();
}

async function salvarEditorRecibo(event) {
    event.preventDefault();
    const corpo = {
        titulo:document.getElementById('reciboTitulo').value, logo_url:document.getElementById('reciboLogo').value,
        texto:document.getElementById('reciboTexto').value, observacoes:document.getElementById('reciboObservacoes').value,
        rodape:document.getElementById('reciboRodape').value, campos:camposEditorRecibo()
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
    const valores = {
        reciboCodigo:pedido.codigo_pedido, reciboCliente:pedido.cliente_nome, reciboCpf:pedido.cpf, reciboEmail:pedido.email,
        reciboTelefone:pedido.telefone, reciboData:pedido.criado_em, reciboStatus:pedido.status, reciboPagamento:pedido.forma_pagamento,
        reciboPagamentoId:pedido.mercadopago_id, reciboCep:pedido.entrega_cep || pedido.cep, reciboSubtotal:pedido.subtotal || 0,
        reciboFrete:pedido.valor_frete || 0, reciboDesconto:pedido.desconto || 0, reciboTotal:pedido.total || 0
    };
    Object.entries(valores).forEach(([id, valor]) => { document.getElementById(id).value = valor || ''; });
    document.getElementById('reciboEndereco').value = [pedido.entrega_logradouro, pedido.entrega_numero, pedido.entrega_complemento, pedido.entrega_bairro, pedido.entrega_cidade, pedido.entrega_estado].filter(Boolean).join(' | ');
    document.getElementById('reciboItens').value = formatarItensRecibo(pedido.produtos);
}

function preencherClienteRecibo() {
    const usuario = usuariosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboClienteSelecionado').value));
    if (!usuario) return;
    [['reciboCliente',usuario.nome],['reciboCpf',usuario.cpf],['reciboEmail',usuario.email],['reciboTelefone',usuario.telefone],['reciboCep',usuario.cep],['reciboEndereco',usuario.endereco]].forEach(([id,valor]) => { document.getElementById(id).value = valor || ''; });
}

function precoEfetivoProdutoRecibo(produto) {
    const preco = Number(produto.preco || 0); const promocional = Number(produto.preco_promocional || 0);
    return Boolean(produto.promocao_ativa) && promocional > 0 && promocional < preco ? promocional : preco;
}

function adicionarProdutoRecibo() {
    const produto = produtosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboProdutoSelecionado').value));
    if (!produto) return;
    const linha = formatarItensRecibo([{ nome:produto.nome, variante:'Padrão', qtd:1, preco:precoEfetivoProdutoRecibo(produto) }]);
    const campo = document.getElementById('reciboItens'); campo.value = [campo.value.trim(), linha].filter(Boolean).join('\n');
    document.getElementById('reciboProdutoSelecionado').value = '';
}

function lerItensRecibo() {
    return document.getElementById('reciboItens').value.split(/\r?\n/).map(linha => {
        const [nome, variante, quantidade, preco] = linha.split('|').map(valor => String(valor || '').trim());
        return { nome, variante:variante || 'Padrão', qtd:Math.max(1, Number(quantidade) || 1), preco:Math.max(0, Number(String(preco || '0').replace(',', '.')) || 0) };
    }).filter(item => item.nome);
}

function lerEnderecoRecibo() {
    const [logradouro, numero, complemento, bairro, cidade, estado] = document.getElementById('reciboEndereco').value.split('|').map(valor => String(valor || '').trim());
    return { cep:document.getElementById('reciboCep').value, logradouro, numero, complemento, bairro, cidade, estado };
}

async function gerarRecibo(event) {
    event.preventDefault();
    const automatico = document.getElementById('reciboModo').value === 'automatico';
    const corpo = { pedido_id:automatico ? Number(document.getElementById('reciboPedido').value) || null : null, dados:{
        pedido:{ codigo:document.getElementById('reciboCodigo').value, data:document.getElementById('reciboData').value, status:document.getElementById('reciboStatus').value, subtotal:Number(document.getElementById('reciboSubtotal').value) || 0, frete:Number(document.getElementById('reciboFrete').value) || 0, desconto:Number(document.getElementById('reciboDesconto').value) || 0, total:Number(document.getElementById('reciboTotal').value) || 0 },
        cliente:{ nome:document.getElementById('reciboCliente').value, cpf:document.getElementById('reciboCpf').value, email:document.getElementById('reciboEmail').value, telefone:document.getElementById('reciboTelefone').value },
        endereco:lerEnderecoRecibo(), pagamento:{ forma:document.getElementById('reciboPagamento').value, id:document.getElementById('reciboPagamentoId').value }, itens:lerItensRecibo()
    }};
    const resposta = await adminFetch('/api/admin/recibos/pdf', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo) });
    if (!resposta.ok) return alert((await resposta.json()).erro || 'Falha ao gerar.');
    const blob = await resposta.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `recibo-core-case-${document.getElementById('reciboCodigo').value || 'manual'}.pdf`; link.click(); URL.revokeObjectURL(link.href);
}

configurarAbasRecibo();
renderizarListaTagsRecibo();
carregarRecibos().catch(() => alert('Não foi possível carregar o módulo de recibos.'));
