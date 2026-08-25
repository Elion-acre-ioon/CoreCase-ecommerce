if (typeof document !== 'undefined') montarNavAdmin('recibos');

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
let itensReciboGerador = [];
let sequenciaItemRecibo = 0;
let timerPreviewRecibo = null;
let configReciboAtual = { titulo:'Recibo Core Case', texto:'', observacoes:'', rodape:'Core Case', logo_url:'', campos:[] };

const ROTULOS_PREVIEW_RECIBO = {
    'pedido.codigo':'Pedido', 'pedido.data':'Data', 'pedido.status':'Status',
    'cliente.nome':'Cliente', 'cliente.cpf':'CPF', 'cliente.email':'E-mail', 'cliente.telefone':'Telefone',
    'endereco.cep':'CEP', 'endereco.logradouro':'Logradouro', 'endereco.numero':'Número', 'endereco.complemento':'Complemento',
    'endereco.bairro':'Bairro', 'endereco.cidade':'Cidade', 'endereco.estado':'Estado',
    'pagamento.forma':'Pagamento', 'pagamento.id':'ID do pagamento',
    'pedido.subtotal':'Subtotal', 'pedido.frete':'Frete', 'pedido.desconto':'Desconto', 'pedido.total':'Total'
};

function normalizarProdutosRespostaRecibo(resposta) {
    return Array.isArray(resposta) ? resposta : [];
}

function variantesProdutoRecibo(produto) {
    let variantes = produto && produto.variantes;
    if (typeof variantes === 'string') {
        try { variantes = JSON.parse(variantes); } catch (e) { variantes = []; }
    }
    const lista = (Array.isArray(variantes) ? variantes : []).map(variante => {
        if (variante && typeof variante === 'object') {
            const preco = variante.preco === null || variante.preco === undefined || variante.preco === '' ? null : Number(variante.preco);
            return { nome:String(variante.nome || '').trim(), preco:Number.isFinite(preco) && preco >= 0 ? preco : null };
        }
        return { nome:String(variante || '').trim(), preco:null };
    }).filter(variante => variante.nome);
    return lista.length ? lista : [{ nome:'Padrão', preco:null }];
}

function precoEfetivoProdutoRecibo(produto) {
    const preco = Math.max(0, Number(produto?.preco || 0));
    const promocional = Number(produto?.preco_promocional || 0);
    return Number(produto?.promocao_ativa) === 1 && promocional > 0 && promocional < preco ? promocional : preco;
}

function precoEfetivoVarianteRecibo(produto, nomeVariante) {
    const variante = variantesProdutoRecibo(produto).find(item => item.nome === nomeVariante);
    return variante && variante.preco !== null ? variante.preco : precoEfetivoProdutoRecibo(produto);
}

function normalizarItemRecibo(item) {
    const qtdInformada = Number(item?.qtd ?? item?.quantidade ?? 1);
    const precoInformado = Number(item?.preco ?? item?.preco_unitario ?? 0);
    return {
        linhaId:String(item?.linhaId || `item-${++sequenciaItemRecibo}`),
        produtoId:item?.produtoId ?? item?.produto_id ?? item?.id ?? null,
        nome:String(item?.nome || 'Produto').trim() || 'Produto',
        variante:String(item?.variante || 'Padrão').trim() || 'Padrão',
        qtd:Number.isInteger(qtdInformada) && qtdInformada > 0 ? qtdInformada : 1,
        preco:Number.isFinite(precoInformado) && precoInformado >= 0 ? Math.round(precoInformado * 100) / 100 : 0
    };
}

function normalizarItensRecibo(itens) {
    return (Array.isArray(itens) ? itens : []).map(normalizarItemRecibo);
}

function adicionarOuSomarItemRecibo(itens, novoItem) {
    const normalizado = normalizarItemRecibo(novoItem);
    const chave = normalizado.produtoId == null ? `livre:${normalizado.nome.toLocaleLowerCase('pt-BR')}` : `produto:${normalizado.produtoId}`;
    const indice = itens.findIndex(item => {
        const chaveItem = item.produtoId == null ? `livre:${item.nome.toLocaleLowerCase('pt-BR')}` : `produto:${item.produtoId}`;
        return chaveItem === chave && item.variante === normalizado.variante;
    });
    if (indice < 0) return [...itens, normalizado];
    return itens.map((item, posicao) => posicao === indice ? { ...item, qtd:item.qtd + normalizado.qtd } : item);
}

function atualizarItemRecibo(itens, linhaId, alteracoes) {
    return itens.map(item => item.linhaId === linhaId ? normalizarItemRecibo({ ...item, ...alteracoes, linhaId:item.linhaId }) : item);
}

function removerItemRecibo(itens, linhaId) {
    return itens.filter(item => item.linhaId !== linhaId);
}

function calcularTotaisRecibo(itens, frete = 0, desconto = 0) {
    const subtotal = Math.round((itens || []).reduce((soma, item) => soma + Number(item.qtd || 0) * Number(item.preco || 0), 0) * 100) / 100;
    const freteValido = Math.max(0, Number(frete) || 0);
    const descontoValido = Math.max(0, Number(desconto) || 0);
    return { subtotal, total:Math.max(0, Math.round((subtotal + freteValido - descontoValido) * 100) / 100) };
}

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
        if (!editor) atualizarPreviewGeradorRecibo();
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

function substituirTagsDadosPreview(texto, dados) {
    return String(texto || '').replace(/\{\{([a-z]+\.[a-z_]+)\}\}/gi, (original, tag) => tag === 'itens.tabela' ? original : valorTagPreviewRecibo(dados, tag));
}

function valorTagPreviewRecibo(dados, tag) {
    const [grupo, campo] = String(tag || '').split('.');
    const valor = dados?.[grupo]?.[campo];
    if (['pedido.subtotal','pedido.frete','pedido.desconto','pedido.total'].includes(tag)) return brlRecibo(valor);
    if (tag === 'pedido.data' && valor) {
        const data = new Date(valor);
        return Number.isNaN(data.getTime()) ? String(valor) : data.toLocaleString('pt-BR');
    }
    return valor == null || valor === '' ? 'Não informado' : String(valor);
}

function camposEditorRecibo() {
    return document.getElementById('reciboCampos').value.split(/\r?\n/).map(valor => valor.trim().replace(/^\{\{|\}\}$/g, '')).filter(tag => TAGS_RECIBO.some(([permitida]) => permitida === tag));
}

function adicionarTabelaPreview(alvo, itens = null) {
    const tabela = document.createElement('table');
    const cabecalho = document.createElement('tr');
    ['Produto','Variante','Qtd.','Unitário','Total'].forEach(rotulo => { const th = document.createElement('th'); th.textContent = rotulo; cabecalho.appendChild(th); });
    const corpo = document.createElement('tbody');
    const linhas = Array.isArray(itens)
        ? itens.map(item => [item.nome, item.variante, String(item.qtd), brlRecibo(item.preco), brlRecibo(item.qtd * item.preco)])
        : [['Capa Premium','Preta','2','R$ 49,95','R$ 99,90'],['Projetor Portátil','Branco','1','R$ 105,00','R$ 105,00']];
    linhas.forEach(valores => {
        const linha = document.createElement('tr'); valores.forEach(valor => { const td = document.createElement('td'); td.textContent = valor; linha.appendChild(td); }); corpo.appendChild(linha);
    });
    tabela.append(cabecalho, corpo); alvo.appendChild(tabela);
}

function brlRecibo(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function adicionarLogoPreview(fragmento, logoUrl) {
    if (!/^https:\/\/res\.cloudinary\.com\//i.test(String(logoUrl || ''))) return;
    const imagem = document.createElement('img');
    imagem.className = 'preview-logo'; imagem.src = logoUrl; imagem.alt = 'Logo do recibo';
    imagem.addEventListener('error', () => imagem.remove()); fragmento.appendChild(imagem);
}

function renderizarModeloPreview(alvo, config, dados, itens) {
    if (!alvo) return;
    const fragmento = document.createDocumentFragment();
    adicionarLogoPreview(fragmento, config.logo_url);
    const titulo = document.createElement('h2'); titulo.textContent = config.titulo || 'Recibo Core Case'; fragmento.appendChild(titulo);
    const codigo = document.createElement('p'); codigo.textContent = `Pedido: ${valorTagPreviewRecibo(dados, 'pedido.codigo')}`; fragmento.appendChild(codigo);
    if (config.texto) { const intro = document.createElement('p'); intro.className = 'preview-intro'; intro.textContent = substituirTagsDadosPreview(config.texto, dados); fragmento.appendChild(intro); }
    (config.campos || []).forEach(tag => {
        if (tag === 'itens.tabela') {
            const itensTitulo = document.createElement('h3'); itensTitulo.textContent = 'Itens'; fragmento.appendChild(itensTitulo);
            if (itens === null || itens?.length) adicionarTabelaPreview(fragmento, itens);
            else { const vazio = document.createElement('p'); vazio.className = 'preview-observacoes'; vazio.textContent = 'Nenhum produto adicionado ao recibo.'; fragmento.appendChild(vazio); }
            return;
        }
        const rotulo = ROTULOS_PREVIEW_RECIBO[tag];
        if (!rotulo) return;
        const linha = document.createElement('p'); linha.className = 'preview-campo';
        const forte = document.createElement('strong'); forte.textContent = rotulo;
        const texto = document.createElement('span'); texto.textContent = valorTagPreviewRecibo(dados, tag); linha.append(forte, texto); fragmento.appendChild(linha);
    });
    if (config.observacoes) { const nota = document.createElement('p'); nota.className = 'preview-observacoes'; nota.textContent = substituirTagsDadosPreview(config.observacoes, dados); fragmento.appendChild(nota); }
    const rodape = document.createElement('footer'); rodape.textContent = substituirTagsDadosPreview(config.rodape || 'Core Case', dados); fragmento.appendChild(rodape);
    alvo.replaceChildren(fragmento);
}

function dadosPreviewGeradorRecibo() {
    return {
        pedido:{ codigo:document.getElementById('reciboCodigo').value, data:document.getElementById('reciboData').value, status:document.getElementById('reciboStatus').value, subtotal:document.getElementById('reciboSubtotal').value, frete:document.getElementById('reciboFrete').value, desconto:document.getElementById('reciboDesconto').value, total:document.getElementById('reciboTotal').value },
        cliente:{ nome:document.getElementById('reciboCliente').value, cpf:document.getElementById('reciboCpf').value, email:document.getElementById('reciboEmail').value, telefone:document.getElementById('reciboTelefone').value },
        endereco:lerEnderecoRecibo(), pagamento:{ forma:document.getElementById('reciboPagamento').value, id:document.getElementById('reciboPagamentoId').value }, itens:itensReciboGerador
    };
}

function atualizarResumoModeloAplicado() {
    const alvo = document.getElementById('reciboModeloAplicado');
    if (!alvo) return;
    const fragmento = document.createDocumentFragment();
    const tituloResumo = document.createElement('h5'); tituloResumo.textContent = 'Modelo aplicado'; fragmento.appendChild(tituloResumo);
    adicionarLogoPreview(fragmento, configReciboAtual.logo_url);
    [['Título', configReciboAtual.titulo || 'Recibo Core Case'], ['Campos', String((configReciboAtual.campos || []).length)], ['Rodapé', configReciboAtual.rodape || 'Core Case']].forEach(([rotulo, valor]) => {
        const linha = document.createElement('p'); const forte = document.createElement('strong'); forte.textContent = `${rotulo}: `; linha.append(forte, document.createTextNode(valor)); fragmento.appendChild(linha);
    });
    alvo.replaceChildren(fragmento);
}

function atualizarPreviewGeradorRecibo() {
    renderizarModeloPreview(document.getElementById('reciboPreviewGerador'), configReciboAtual, dadosPreviewGeradorRecibo(), itensReciboGerador);
    atualizarResumoModeloAplicado();
}

function atualizarPreviewRecibo() {
    const configEditor = coletarConfigEditorRecibo();
    const dados = { pedido:{ codigo:AMOSTRA_RECIBO['pedido.codigo'], data:AMOSTRA_RECIBO['pedido.data'], status:AMOSTRA_RECIBO['pedido.status'], subtotal:199.9, frete:15, desconto:10, total:204.9 }, cliente:{ nome:AMOSTRA_RECIBO['cliente.nome'], cpf:AMOSTRA_RECIBO['cliente.cpf'], email:AMOSTRA_RECIBO['cliente.email'], telefone:AMOSTRA_RECIBO['cliente.telefone'] }, endereco:{ cep:AMOSTRA_RECIBO['endereco.cep'], logradouro:AMOSTRA_RECIBO['endereco.logradouro'], numero:AMOSTRA_RECIBO['endereco.numero'], complemento:AMOSTRA_RECIBO['endereco.complemento'], bairro:AMOSTRA_RECIBO['endereco.bairro'], cidade:AMOSTRA_RECIBO['endereco.cidade'], estado:AMOSTRA_RECIBO['endereco.estado'] }, pagamento:{ forma:AMOSTRA_RECIBO['pagamento.forma'], id:AMOSTRA_RECIBO['pagamento.id'] } };
    renderizarModeloPreview(document.getElementById('reciboPreview'), configEditor, dados, null);
}

function coletarConfigEditorRecibo() {
    return { titulo:document.getElementById('reciboTitulo').value, logo_url:document.getElementById('reciboLogo').value.trim(), texto:document.getElementById('reciboTexto').value, observacoes:document.getElementById('reciboObservacoes').value, rodape:document.getElementById('reciboRodape').value, campos:camposEditorRecibo() };
}

function aplicarConfigRecibo(config) {
    configReciboAtual = { ...config, campos:Array.isArray(config?.campos) ? config.campos : [] };
    document.getElementById('reciboTitulo').value = configReciboAtual.titulo || '';
    document.getElementById('reciboLogo').value = configReciboAtual.logo_url || '';
    document.getElementById('reciboTexto').value = configReciboAtual.texto || '';
    document.getElementById('reciboObservacoes').value = configReciboAtual.observacoes || '';
    document.getElementById('reciboRodape').value = configReciboAtual.rodape || '';
    document.getElementById('reciboCampos').value = configReciboAtual.campos.map(campo => `{{${campo}}}`).join('\n');
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
    produtosRecibo = normalizarProdutosRespostaRecibo(produtos);
    aplicarConfigRecibo(config);
    document.getElementById('reciboPedido').innerHTML = '<option value="">Selecione</option>' + pedidosRecibo.map(pedido => `<option value="${Number(pedido.id)}">#${escaparOpcaoRecibo(pedido.codigo_pedido)} - ${escaparOpcaoRecibo(pedido.cliente_nome || 'Cliente')}</option>`).join('');
    document.getElementById('reciboClienteSelecionado').innerHTML = '<option value="">Selecione</option>' + usuariosRecibo.map(usuario => `<option value="${Number(usuario.id)}">${escaparOpcaoRecibo(usuario.nome)} - ${escaparOpcaoRecibo(usuario.email)}</option>`).join('');
    document.getElementById('reciboProdutoSelecionado').innerHTML = '<option value="">Selecione um produto</option>' + produtosRecibo.map(produto => `<option value="${Number(produto.id)}">${escaparOpcaoRecibo(produto.nome)}</option>`).join('') + '<option value="livre">Item não cadastrado</option>';
    document.getElementById('reciboPedido').addEventListener('change', preencherPedidoRecibo);
    document.getElementById('reciboClienteSelecionado').addEventListener('change', preencherClienteRecibo);
    document.getElementById('reciboProdutoSelecionado').addEventListener('change', configurarProdutoSelecionadoRecibo);
    document.getElementById('reciboProdutoVariante').addEventListener('change', atualizarPrecoProdutoSelecionadoRecibo);
    document.getElementById('btnAdicionarProdutoRecibo').addEventListener('click', adicionarProdutoRecibo);
    document.getElementById('reciboItensLista').addEventListener('input', alterarItemListaRecibo);
    document.getElementById('reciboItensLista').addEventListener('change', alterarItemListaRecibo);
    document.getElementById('reciboItensLista').addEventListener('click', removerItemListaRecibo);
    ['reciboFrete','reciboDesconto'].forEach(id => document.getElementById(id).addEventListener('input', recalcularRecibo));
    document.getElementById('reciboTotal').addEventListener('input', atualizarPreviewGeradorRecibo);
    document.getElementById('reciboTotalManual').addEventListener('change', alternarTotalManualRecibo);
    ['reciboCodigo','reciboCliente','reciboCpf','reciboEmail','reciboTelefone','reciboData','reciboStatus','reciboPagamento','reciboPagamentoId','reciboCep','reciboEndereco'].forEach(id => document.getElementById(id).addEventListener('input', atualizarPreviewGeradorRecibo));
    ['reciboTitulo','reciboLogo','reciboTexto','reciboObservacoes','reciboRodape','reciboCampos'].forEach(id => document.getElementById(id).addEventListener('input', agendarPreviewRecibo));
    alternarModoRecibo(); renderizarItensRecibo(); atualizarPreviewRecibo();
}

async function salvarEditorRecibo(event) {
    event.preventDefault();
    const corpo = coletarConfigEditorRecibo();
    const resposta = await adminFetch('/api/admin/recibos/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo) });
    const resultado = await resposta.json();
    if (!resposta.ok) return alert(resultado.erro || 'Não foi possível salvar.');
    const configSalva = resultado.config || {};
    aplicarConfigRecibo(configSalva);
    atualizarPreviewRecibo();
    atualizarPreviewGeradorRecibo();
    if (corpo.logo_url && !configSalva.logo_url) return alert('A URL da logo não foi aceita. Use uma imagem válida hospedada no Cloudinary.');
    alert('Editor salvo.');
}

function alternarModoRecibo() {
    const automatico = document.getElementById('reciboModo').value === 'automatico';
    document.getElementById('reciboPedidoGrupo').hidden = !automatico;
    document.getElementById('reciboSeletoresManuais').hidden = automatico;
    document.getElementById('reciboPedido').required = automatico;
    document.getElementById('tituloItensRecibo').textContent = automatico ? 'Itens do pedido' : 'Itens adicionados';
    atualizarPreviewGeradorRecibo();
}

function formatarItensRecibo(itens) {
    return (Array.isArray(itens) ? itens : []).map(item => [item.nome || 'Produto', item.variante || 'Padrão', Number(item.qtd || item.quantidade || 1), Number(item.preco || item.preco_unitario || 0).toFixed(2)].join(' | ')).join('\n');
}

function sincronizarItensRecibo() {
    document.getElementById('reciboItens').value = formatarItensRecibo(itensReciboGerador);
}

function recalcularRecibo() {
    const frete = document.getElementById('reciboFrete').value;
    const desconto = document.getElementById('reciboDesconto').value;
    const totais = calcularTotaisRecibo(itensReciboGerador, frete, desconto);
    document.getElementById('reciboSubtotal').value = totais.subtotal.toFixed(2);
    if (!document.getElementById('reciboTotalManual').checked) document.getElementById('reciboTotal').value = totais.total.toFixed(2);
    atualizarPreviewGeradorRecibo();
}

function alternarTotalManualRecibo() {
    const manual = document.getElementById('reciboTotalManual').checked;
    document.getElementById('reciboTotal').readOnly = !manual;
    if (!manual) recalcularRecibo();
    else document.getElementById('reciboTotal').focus();
}

function criarCampoItemRecibo(rotulo, controle) {
    const grupo = document.createElement('label'); grupo.className = 'recibo-item-campo';
    const texto = document.createElement('span'); texto.textContent = rotulo; grupo.append(texto, controle);
    return grupo;
}

function renderizarItensRecibo() {
    const lista = document.getElementById('reciboItensLista');
    const fragmento = document.createDocumentFragment();
    itensReciboGerador.forEach(item => {
        const cartao = document.createElement('article'); cartao.className = 'recibo-item'; cartao.dataset.linhaId = item.linhaId;
        const cabecalho = document.createElement('div'); cabecalho.className = 'recibo-item-cabecalho';
        const nome = document.createElement('strong'); nome.textContent = item.nome;
        const remover = document.createElement('button'); remover.type = 'button'; remover.className = 'btn-perigo btn-pequeno'; remover.dataset.acao = 'remover'; remover.textContent = 'Remover'; remover.setAttribute('aria-label', `Remover ${item.nome}`);
        cabecalho.append(nome, remover);
        const campos = document.createElement('div'); campos.className = 'recibo-item-campos';
        const produto = produtosRecibo.find(produtoItem => Number(produtoItem.id) === Number(item.produtoId));
        let variante;
        if (produto) {
            variante = document.createElement('select'); variante.dataset.campo = 'variante';
            variantesProdutoRecibo(produto).forEach(opcao => { const elemento = document.createElement('option'); elemento.value = opcao.nome; elemento.textContent = opcao.nome; elemento.selected = opcao.nome === item.variante; variante.appendChild(elemento); });
        } else {
            variante = document.createElement('input'); variante.value = item.variante; variante.maxLength = 80; variante.dataset.campo = 'variante';
        }
        const quantidade = document.createElement('input'); quantidade.type = 'number'; quantidade.min = '1'; quantidade.step = '1'; quantidade.inputMode = 'numeric'; quantidade.value = String(item.qtd); quantidade.dataset.campo = 'qtd';
        const preco = document.createElement('input'); preco.type = 'number'; preco.min = '0'; preco.step = '0.01'; preco.inputMode = 'decimal'; preco.value = item.preco.toFixed(2); preco.dataset.campo = 'preco';
        const total = document.createElement('output'); total.className = 'recibo-item-total'; total.textContent = brlRecibo(item.qtd * item.preco);
        campos.append(criarCampoItemRecibo('Variante', variante), criarCampoItemRecibo('Quantidade', quantidade), criarCampoItemRecibo('Unitário (R$)', preco), criarCampoItemRecibo('Total', total));
        cartao.append(cabecalho, campos); fragmento.appendChild(cartao);
    });
    lista.replaceChildren(fragmento);
    document.getElementById('reciboItensVazio').hidden = itensReciboGerador.length > 0;
    sincronizarItensRecibo();
    recalcularRecibo();
}

function configurarProdutoSelecionadoRecibo() {
    const valor = document.getElementById('reciboProdutoSelecionado').value;
    const livre = valor === 'livre';
    const produto = produtosRecibo.find(item => Number(item.id) === Number(valor));
    document.getElementById('reciboProdutoLivreGrupo').hidden = !livre;
    document.getElementById('reciboVarianteCatalogoGrupo').hidden = livre;
    document.getElementById('reciboVarianteLivreGrupo').hidden = !livre;
    const seletorVariante = document.getElementById('reciboProdutoVariante');
    seletorVariante.replaceChildren();
    if (produto) {
        variantesProdutoRecibo(produto).forEach(variante => { const opcao = document.createElement('option'); opcao.value = variante.nome; opcao.textContent = variante.nome; seletorVariante.appendChild(opcao); });
        seletorVariante.disabled = false;
        document.getElementById('reciboProdutoPreco').value = precoEfetivoVarianteRecibo(produto, seletorVariante.value).toFixed(2);
    } else {
        const opcao = document.createElement('option'); opcao.textContent = livre ? 'Informe ao lado' : 'Selecione o produto'; seletorVariante.appendChild(opcao);
        seletorVariante.disabled = true;
        document.getElementById('reciboProdutoPreco').value = '0.00';
    }
    document.getElementById('reciboProdutoQuantidade').value = '1';
    mostrarFeedbackProdutoRecibo('', false);
}

function atualizarPrecoProdutoSelecionadoRecibo() {
    const produto = produtosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboProdutoSelecionado').value));
    if (produto) document.getElementById('reciboProdutoPreco').value = precoEfetivoVarianteRecibo(produto, document.getElementById('reciboProdutoVariante').value).toFixed(2);
}

function mostrarFeedbackProdutoRecibo(mensagem, erro) {
    const alvo = document.getElementById('reciboProdutoFeedback');
    alvo.textContent = mensagem;
    alvo.classList.toggle('erro', Boolean(erro));
}

function adicionarProdutoRecibo() {
    const valor = document.getElementById('reciboProdutoSelecionado').value;
    const livre = valor === 'livre';
    const produto = produtosRecibo.find(item => Number(item.id) === Number(valor));
    if (!produto && !livre) return mostrarFeedbackProdutoRecibo('Selecione um produto.', true);
    const nome = livre ? document.getElementById('reciboProdutoLivre').value.trim() : produto.nome;
    if (!nome) return mostrarFeedbackProdutoRecibo('Informe o nome do item.', true);
    const variante = livre ? document.getElementById('reciboProdutoVarianteLivre').value.trim() || 'Padrão' : document.getElementById('reciboProdutoVariante').value;
    if (!variante || (!livre && !variantesProdutoRecibo(produto).some(item => item.nome === variante))) return mostrarFeedbackProdutoRecibo('Variante inválida.', true);
    const qtd = Number(document.getElementById('reciboProdutoQuantidade').value);
    if (!Number.isInteger(qtd) || qtd < 1) return mostrarFeedbackProdutoRecibo('A quantidade deve ser um número inteiro maior que zero.', true);
    const preco = Number(document.getElementById('reciboProdutoPreco').value);
    if (!Number.isFinite(preco) || preco < 0) return mostrarFeedbackProdutoRecibo('Informe um valor unitário válido.', true);
    itensReciboGerador = adicionarOuSomarItemRecibo(itensReciboGerador, { produtoId:produto?.id ?? null, nome, variante, qtd, preco });
    renderizarItensRecibo();
    mostrarFeedbackProdutoRecibo('Produto adicionado.', false);
    document.getElementById('reciboProdutoQuantidade').value = '1';
}

function alterarItemListaRecibo(event) {
    const controle = event.target.closest('[data-campo]');
    const cartao = event.target.closest('[data-linha-id]');
    if (!controle || !cartao) return;
    const item = itensReciboGerador.find(itemAtual => itemAtual.linhaId === cartao.dataset.linhaId);
    if (!item) return;
    const campo = controle.dataset.campo;
    let valor = controle.value;
    if (campo === 'qtd') {
        valor = Number(valor);
        if (!Number.isInteger(valor) || valor < 1) {
            if (event.type === 'change') controle.value = String(item.qtd);
            return;
        }
    }
    if (campo === 'preco') {
        valor = Number(valor);
        if (!Number.isFinite(valor) || valor < 0) {
            if (event.type === 'change') controle.value = item.preco.toFixed(2);
            return;
        }
    }
    const alteracoes = { [campo]:valor };
    if (campo === 'variante' && item.produtoId != null) {
        const produto = produtosRecibo.find(produtoItem => Number(produtoItem.id) === Number(item.produtoId));
        if (produto) alteracoes.preco = precoEfetivoVarianteRecibo(produto, valor);
    }
    itensReciboGerador = atualizarItemRecibo(itensReciboGerador, item.linhaId, alteracoes);
    if (campo === 'variante') return renderizarItensRecibo();
    const atualizado = itensReciboGerador.find(itemAtual => itemAtual.linhaId === item.linhaId);
    const total = cartao.querySelector('.recibo-item-total');
    if (total && atualizado) total.textContent = brlRecibo(atualizado.qtd * atualizado.preco);
    sincronizarItensRecibo();
    recalcularRecibo();
}

function removerItemListaRecibo(event) {
    const botao = event.target.closest('[data-acao="remover"]');
    const cartao = event.target.closest('[data-linha-id]');
    if (!botao || !cartao) return;
    itensReciboGerador = removerItemRecibo(itensReciboGerador, cartao.dataset.linhaId);
    renderizarItensRecibo();
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
    itensReciboGerador = normalizarItensRecibo(pedido.produtos);
    renderizarItensRecibo();
}

function preencherClienteRecibo() {
    const usuario = usuariosRecibo.find(item => Number(item.id) === Number(document.getElementById('reciboClienteSelecionado').value));
    if (!usuario) return;
    [['reciboCliente',usuario.nome],['reciboCpf',usuario.cpf],['reciboEmail',usuario.email],['reciboTelefone',usuario.telefone],['reciboCep',usuario.cep],['reciboEndereco',usuario.endereco]].forEach(([id,valor]) => { document.getElementById(id).value = valor || ''; });
}

function lerItensRecibo() {
    return itensReciboGerador.map(({ nome, variante, qtd, preco }) => ({ nome, variante, qtd, preco }));
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

const recibosTeste = {
    normalizarProdutosRespostaRecibo,
    variantesProdutoRecibo,
    precoEfetivoProdutoRecibo,
    precoEfetivoVarianteRecibo,
    normalizarItensRecibo,
    adicionarOuSomarItemRecibo,
    atualizarItemRecibo,
    removerItemRecibo,
    calcularTotaisRecibo,
    formatarItensRecibo
};

if (typeof module !== 'undefined' && module.exports) module.exports = recibosTeste;

if (typeof document !== 'undefined') {
    configurarAbasRecibo();
    renderizarListaTagsRecibo();
    carregarRecibos().catch(() => alert('Não foi possível carregar o módulo de recibos.'));
}
