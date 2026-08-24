montarNavAdmin('analise');

const SVG_NS = 'http://www.w3.org/2000/svg';
const CORES_GRAFICO = ['#e11d48','#8c8c8c','#d7a928','#2f9e68','#64748b','#b45309','#a1a1aa'];
const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');

function numeroSeguro(valor) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : 0;
}

function dinheiroAnalise(valor) {
    return numeroSeguro(valor).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function isoLocal(data) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function intervaloPeriodo(tipo) {
    const fim = new Date();
    let inicio = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
    if (tipo === 'mes') inicio = new Date(fim.getFullYear(), fim.getMonth(), 1);
    else inicio.setDate(inicio.getDate() - Math.max(0, Number(tipo || 30) - 1));
    return { inicio:isoLocal(inicio), fim:isoLocal(fim) };
}

function aplicarPeriodo(tipo) {
    const periodo = intervaloPeriodo(tipo);
    document.getElementById('dataInicio').value = periodo.inicio;
    document.getElementById('dataFim').value = periodo.fim;
    document.querySelectorAll('[data-periodo]').forEach(botao => botao.classList.toggle('active', botao.dataset.periodo === tipo));
    carregarAnalise();
}

function mensagemSemDados(alvo) {
    const p = document.createElement('p'); p.className = 'analytics-vazio'; p.textContent = 'Sem dados no período.'; alvo.replaceChildren(p);
}

function animarNumero(elemento, valor, formato) {
    const destino = numeroSeguro(valor);
    if (movimentoReduzido.matches) { elemento.textContent = formato(destino); return; }
    const inicio = performance.now();
    function quadro(agora) {
        const progresso = Math.min(1, (agora - inicio) / 350);
        elemento.textContent = formato(destino * (1 - Math.pow(1 - progresso, 3)));
        if (progresso < 1) requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);
}

function renderizarKpis(resumo) {
    const inteiro = valor => Math.round(valor).toLocaleString('pt-BR');
    const definicoes = [
        ['Faturamento aprovado', resumo.faturamento_aprovado, dinheiroAnalise], ['Pedidos pagos', resumo.pedidos_pagos, inteiro], ['Ticket médio', resumo.ticket_medio, dinheiroAnalise],
        ['Unidades vendidas', resumo.unidades_vendidas, inteiro], ['Clientes únicos', resumo.clientes_unicos, inteiro], ['Pedidos pendentes', resumo.pedidos_pendentes, inteiro],
        ['Pedidos cancelados', resumo.pedidos_cancelados, inteiro], ['Taxa de aprovação', numeroSeguro(resumo.taxa_aprovacao) * 100, valor => `${Math.round(valor)}%`],
        ['Solicitações de reembolso', resumo.solicitacoes_reembolso, inteiro], ['Clientes novos', resumo.clientes_novos, inteiro], ['Clientes recorrentes', resumo.clientes_recorrentes, inteiro]
    ];
    const alvo = document.getElementById('cardsResumo'); const fragmento = document.createDocumentFragment();
    definicoes.forEach(([titulo, valor, formato], indice) => {
        const card = document.createElement('article'); card.className = 'analytics-card'; card.style.setProperty('--entrada-indice', indice);
        const rotulo = document.createElement('span'); rotulo.textContent = titulo; const numero = document.createElement('strong'); numero.textContent = formato(0); card.append(rotulo, numero); fragmento.appendChild(card);
        window.setTimeout(() => animarNumero(numero, valor, formato), movimentoReduzido.matches ? 0 : indice * 18);
    });
    alvo.replaceChildren(fragmento);
}

function criarSvg(viewBox = '0 0 680 260') {
    const svg = document.createElementNS(SVG_NS, 'svg'); svg.classList.add('analytics-svg'); svg.setAttribute('viewBox', viewBox); svg.setAttribute('role', 'img'); return svg;
}

function elementoSvg(nome, atributos = {}) {
    const elemento = document.createElementNS(SVG_NS, nome);
    Object.entries(atributos).forEach(([chave, valor]) => elemento.setAttribute(chave, String(valor)));
    return elemento;
}

function renderizarLinhaFaturamento(linhas) {
    const alvo = document.getElementById('graficoFaturamento'); const lista = Array.isArray(linhas) ? linhas : [];
    if (!lista.length) return mensagemSemDados(alvo);
    const svg = criarSvg(); svg.setAttribute('aria-label', 'Faturamento aprovado por dia');
    const largura = 680, altura = 260, margemX = 42, margemY = 28; const maximo = Math.max(...lista.map(item => numeroSeguro(item.faturamento)), 1);
    const pontos = lista.map((item, indice) => ({ x:margemX + indice * (largura - margemX * 2) / Math.max(1, lista.length - 1), y:altura - margemY - numeroSeguro(item.faturamento) / maximo * (altura - margemY * 2), item }));
    [0,.25,.5,.75,1].forEach(parte => { const y = altura - margemY - parte * (altura - margemY * 2); svg.appendChild(elementoSvg('line', { x1:margemX, y1:y, x2:largura-margemX, y2:y, class:'analytics-grid-line' })); });
    const caminho = pontos.map((p,i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '); const area = `${caminho} L ${pontos.at(-1).x} ${altura-margemY} L ${pontos[0].x} ${altura-margemY} Z`;
    svg.appendChild(elementoSvg('path', { d:area, class:'analytics-area' })); const linha = elementoSvg('path', { d:caminho, class:'analytics-line' }); svg.appendChild(linha);
    pontos.forEach(ponto => { const circulo = elementoSvg('circle', { cx:ponto.x, cy:ponto.y, r:4, class:'analytics-point' }); const titulo = elementoSvg('title'); titulo.textContent = `${ponto.item.dia}: ${dinheiroAnalise(ponto.item.faturamento)}`; circulo.appendChild(titulo); svg.appendChild(circulo); });
    const primeira = elementoSvg('text', { x:margemX, y:altura-7, class:'analytics-axis-label' }); primeira.textContent = String(lista[0].dia).slice(5); const ultima = elementoSvg('text', { x:largura-margemX, y:altura-7, 'text-anchor':'end', class:'analytics-axis-label' }); ultima.textContent = String(lista.at(-1).dia).slice(5); svg.append(primeira, ultima);
    alvo.replaceChildren(svg);
    if (!movimentoReduzido.matches) { const tamanho = linha.getTotalLength(); linha.style.strokeDasharray = tamanho; linha.style.strokeDashoffset = tamanho; requestAnimationFrame(() => { linha.style.strokeDashoffset = '0'; }); }
}

function renderizarDonut(id, linhas, campoRotulo, campoValor) {
    const alvo = document.getElementById(id); const lista = (Array.isArray(linhas) ? linhas : []).filter(item => numeroSeguro(item[campoValor]) > 0);
    if (!lista.length) return mensagemSemDados(alvo);
    const total = lista.reduce((soma,item) => soma + numeroSeguro(item[campoValor]), 0); const wrap = document.createElement('div'); wrap.className = 'analytics-donut-wrap'; const svg = criarSvg('0 0 200 200'); svg.classList.add('analytics-donut');
    svg.appendChild(elementoSvg('circle', { cx:100, cy:100, r:70, class:'analytics-donut-base' })); let acumulado = 0;
    lista.forEach((item, indice) => { const fracao = numeroSeguro(item[campoValor]) / total; const circulo = elementoSvg('circle', { cx:100, cy:100, r:70, class:'analytics-donut-segmento', stroke:CORES_GRAFICO[indice % CORES_GRAFICO.length], 'stroke-dasharray':`${fracao * 439.82} 439.82`, 'stroke-dashoffset':`${-acumulado * 439.82}` }); if (!movimentoReduzido.matches) circulo.classList.add('animar'); svg.appendChild(circulo); acumulado += fracao; });
    const totalTexto = elementoSvg('text', { x:100, y:97, 'text-anchor':'middle', class:'analytics-donut-total' }); totalTexto.textContent = total; const totalRotulo = elementoSvg('text', { x:100, y:119, 'text-anchor':'middle', class:'analytics-axis-label' }); totalRotulo.textContent = 'total'; svg.append(totalTexto, totalRotulo);
    const legenda = document.createElement('div'); legenda.className = 'analytics-legenda'; lista.forEach((item, indice) => { const linha = document.createElement('p'); const cor = document.createElement('i'); cor.style.background = CORES_GRAFICO[indice % CORES_GRAFICO.length]; const texto = document.createElement('span'); texto.textContent = `${item[campoRotulo] || '-'}: ${numeroSeguro(item[campoValor])}`; linha.append(cor,texto); legenda.appendChild(linha); });
    wrap.append(svg,legenda); alvo.replaceChildren(wrap);
}

function renderizarBarrasHorizontais(id, linhas, campoRotulo, campoValor, detalhe) {
    const alvo = document.getElementById(id); const lista = Array.isArray(linhas) ? linhas : [];
    if (!lista.length) return mensagemSemDados(alvo);
    const maximo = Math.max(...lista.map(item => numeroSeguro(item[campoValor])), 1); const fragmento = document.createDocumentFragment();
    lista.forEach(item => { const bloco = document.createElement('div'); bloco.className = 'analytics-hbar'; const topo = document.createElement('div'); const nome = document.createElement('span'); nome.textContent = item[campoRotulo] || '-'; const valor = document.createElement('strong'); valor.textContent = detalhe(item); topo.append(nome,valor); const fundo = document.createElement('div'); const barra = document.createElement('i'); barra.style.setProperty('--largura-barra', `${numeroSeguro(item[campoValor]) / maximo * 100}%`); fundo.appendChild(barra); bloco.append(topo,fundo); fragmento.appendChild(bloco); }); alvo.replaceChildren(fragmento);
}

function renderizarComparacao(vendas, reembolsos) {
    const alvo = document.getElementById('graficoComparacao'); const mapa = new Map();
    (vendas || []).forEach(item => mapa.set(String(item.dia).slice(0,10), { dia:String(item.dia).slice(0,10), vendas:numeroSeguro(item.pedidos), reembolsos:0 }));
    (reembolsos || []).forEach(item => { const dia = String(item.dia).slice(0,10); const atual = mapa.get(dia) || { dia, vendas:0, reembolsos:0 }; atual.reembolsos = numeroSeguro(item.solicitacoes); mapa.set(dia, atual); });
    const lista = [...mapa.values()].sort((a,b) => a.dia.localeCompare(b.dia)); if (!lista.length) return mensagemSemDados(alvo);
    const maximo = Math.max(...lista.flatMap(item => [item.vendas,item.reembolsos]), 1); const grade = document.createElement('div'); grade.className = 'analytics-comparacao';
    lista.forEach(item => { const coluna = document.createElement('div'); coluna.className = 'analytics-comparacao-coluna'; const barras = document.createElement('div'); barras.className = 'analytics-comparacao-barras'; const venda = document.createElement('i'); venda.className = 'venda'; venda.style.setProperty('--altura-barra', `${item.vendas / maximo * 100}%`); venda.title = `${item.vendas} pedidos pagos`; const reembolso = document.createElement('i'); reembolso.className = 'reembolso'; reembolso.style.setProperty('--altura-barra', `${item.reembolsos / maximo * 100}%`); reembolso.title = `${item.reembolsos} solicitações`; barras.append(venda,reembolso); const data = document.createElement('span'); data.textContent = item.dia.slice(5); coluna.append(barras,data); grade.appendChild(coluna); });
    const legenda = document.createElement('p'); legenda.className = 'analytics-legenda-inline'; legenda.innerHTML = '<i></i> Pedidos pagos <i></i> Solicitações de reembolso'; alvo.replaceChildren(grade,legenda);
}

async function carregarAnalise() {
    const inicio = document.getElementById('dataInicio').value; const fim = document.getElementById('dataFim').value; const cards = document.getElementById('cardsResumo'); cards.innerHTML = '<p class="muted">Carregando dados...</p>'; document.querySelector('.analytics-dashboard').classList.add('atualizando');
    try {
        const resposta = await adminFetch(`/api/admin/analytics/resumo?data_inicio=${encodeURIComponent(inicio)}&data_fim=${encodeURIComponent(fim)}`); const dados = await resposta.json(); if (!resposta.ok) throw new Error(dados.erro || 'Erro ao carregar análise.');
        renderizarKpis(dados.resumo || {}); renderizarLinhaFaturamento(dados.porDia); renderizarDonut('graficoStatus', dados.porStatus, 'status', 'total'); renderizarBarrasHorizontais('graficoProdutos', dados.produtos, 'nome', 'quantidade', item => `${numeroSeguro(item.quantidade)} un. · ${dinheiroAnalise(item.faturamento)}`); renderizarComparacao(dados.porDia, dados.reembolsosPorDia); renderizarDonut('graficoPagamentos', dados.pagamentos, 'nome', 'pedidos'); renderizarBarrasHorizontais('graficoOrigens', dados.origens, 'origem', 'pedidos', item => `${numeroSeguro(item.pedidos)} pedidos · ${dinheiroAnalise(item.faturamento)}`);
    } catch (erro) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = erro.message || 'Erro ao carregar análise.'; cards.replaceChildren(p); }
    finally { document.querySelector('.analytics-dashboard').classList.remove('atualizando'); }
}

document.querySelectorAll('[data-periodo]').forEach(botao => botao.addEventListener('click', () => aplicarPeriodo(botao.dataset.periodo)));
document.getElementById('atualizarAnalise').addEventListener('click', () => { document.querySelectorAll('[data-periodo]').forEach(botao => botao.classList.remove('active')); carregarAnalise(); });
const inicial = intervaloPeriodo('30'); document.getElementById('dataInicio').value = inicial.inicio; document.getElementById('dataFim').value = inicial.fim; carregarAnalise();
