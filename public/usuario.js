/* ============================================================================
 * ARQUIVO: usuario.js
 * Funções compartilhadas de sessão do usuário (cliente) e carrinho por conta.
 * Deve ser incluído em TODAS as páginas públicas: index, loja, produto,
 * cart, checkout, cliente-config e login.
 * ============================================================================ */

// ---------- SESSÃO DO USUÁRIO ----------

function obterUsuarioLogado() {
    try {
        return JSON.parse(localStorage.getItem('usuario_logado') || 'null');
    } catch (e) {
        return null;
    }
}

function salvarUsuarioLogado(usuario) {
    localStorage.setItem('usuario_logado', JSON.stringify(usuario));
}

async function fazerLogout(event) {
    if (event) event.preventDefault();
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    // O carrinho não é apagado do "banco" (localStorage), só some da tela.
    // Ele continua salvo na chave carrinho_usuario_<id> e volta ao logar de novo.
    localStorage.removeItem('usuario_logado');
    localStorage.removeItem('userToken');
    window.location.href = '/index.html';
}

// ---------- MENU SUPERIOR (nome do usuário no cabeçalho) ----------

function atualizarMenuUsuario() {
    const container = document.getElementById('menu-usuario');
    if (!container) return;

    const usuarioLogado = obterUsuarioLogado();

    if (usuarioLogado) {
        const primeiroNome = (usuarioLogado.nome || 'Cliente').split(' ')[0];

        container.innerHTML = `
            <div class="user-dropdown" style="position: relative; display: inline-block;">
                <button onclick="toggleMenuDropdown(event)" style="background: none; border: none; color: #cbd5e1; font-weight: 600; font-size: 14px; cursor: pointer; text-transform: lowercase; display: flex; align-items: center; gap: 6px;">
                    👤 ${primeiroNome} ▼
                </button>
                <div id="dropdownContent" style="display: none; position: absolute; right: 0; background-color: #121212; min-width: 170px; box-shadow: 0px 8px 16px rgba(0,0,0,0.3); z-index: 10; border: 1px solid #e11d48; border-radius: 6px; overflow: hidden; margin-top: 8px;">
                    ${Number(usuarioLogado.is_admin) === 1
                        ? '<a href="/admin-loja.html" style="color:#ffffff; padding:12px 16px; text-decoration:none; display:block; font-size:13px; border-bottom:1px solid #222;">Administrador</a>'
                        : '<a href="/cliente-config.html" style="color:#ffffff; padding:12px 16px; text-decoration:none; display:block; font-size:13px; border-bottom:1px solid #222;">Configurações</a><a href="/historico.html" style="color:#ffffff; padding:12px 16px; text-decoration:none; display:block; font-size:13px; border-bottom:1px solid #222;">Histórico de Compras</a>'}
                    <a href="#" onclick="fazerLogout(event)" style="color:#e11d48; padding:12px 16px; text-decoration:none; display:block; font-size:13px; font-weight:bold;">Sair</a>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `<a href="/login.html" style="color:#cbd5e1; text-decoration:none; font-weight:600; font-size:14px; text-transform:lowercase;">login</a>`;
    }
}

function toggleMenuDropdown(event) {
    if (event) event.stopPropagation();
    const drop = document.getElementById('dropdownContent');
    if (!drop) return;

    const vaiAbrir = drop.style.display !== 'block';
    drop.style.display = vaiAbrir ? 'block' : 'none';

    const nav = drop.closest('.nav-principal, .header-links');
    if (nav) nav.classList.toggle('menu-aberto', vaiAbrir);

    if (vaiAbrir && window.matchMedia('(max-width: 768px)').matches) {
        const botao = event ? event.currentTarget : drop.previousElementSibling;
        const rect = botao.getBoundingClientRect();
        drop.style.position = 'fixed';
        drop.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 12)}px`;
        drop.style.right = '12px';
        drop.style.left = 'auto';
        drop.style.zIndex = '3000';
    } else if (!vaiAbrir) {
        drop.style.position = 'absolute';
        drop.style.top = '';
        drop.style.right = '0';
        drop.style.left = '';
    }
}

// Fecha o dropdown ao clicar fora dele
window.addEventListener('click', function (event) {
    const drop = document.getElementById('dropdownContent');
    if (drop && drop.style.display === 'block') {
        if (!event.target.closest('.user-dropdown')) {
            drop.style.display = 'none';
            drop.style.position = 'absolute';
            drop.style.top = '';
            drop.style.right = '0';
            drop.style.left = '';
            const nav = document.querySelector('.nav-principal.menu-aberto, .header-links.menu-aberto');
            if (nav) nav.classList.remove('menu-aberto');
        }
    }
});

// ---------- CARRINHO (individual por conta — exige login) ----------

function obterChaveCarrinho() {
    const usuario = obterUsuarioLogado();
    if (!usuario || !usuario.id) return null; // visitante não tem carrinho
    return `carrinho_usuario_${usuario.id}`;
}

function normalizarCarrinho(carrinho) {
    if (!Array.isArray(carrinho)) return [];
    return carrinho.map(item => ({
        id: item.id || 0,
        nome: item.nome || 'Produto sem nome',
        preco: Number(item.preco) || 0,
        foto: item.foto || 'https://via.placeholder.com/70?text=Core',
        qtd: Number(item.qtd) || 1,
        selecionado: item.selecionado !== false
    }));
}

function carregarCarrinho() {
    const chave = obterChaveCarrinho();
    if (!chave) return [];
    try {
        return normalizarCarrinho(JSON.parse(localStorage.getItem(chave) || '[]'));
    } catch (e) {
        return [];
    }
}

function salvarCarrinho(carrinho) {
    const chave = obterChaveCarrinho();
    if (!chave) return false;
    localStorage.setItem(chave, JSON.stringify(carrinho));
    return true;
}

// Bloqueia o uso do carrinho para visitante e manda para o login
function exigirLoginParaCarrinho() {
    const usuario = obterUsuarioLogado();
    if (!usuario) {
        alert('Você precisa fazer login ou se cadastrar para usar o carrinho.');
        localStorage.setItem('redirecionar_depois', window.location.pathname + window.location.search);
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// Usada em loja.html e produto.html para adicionar item
function adicionarItemAoCarrinho(item) {
    if (!exigirLoginParaCarrinho()) return false;

    let carrinho = carregarCarrinho();
    // Mescla quantidade apenas se for o MESMO produto E a MESMA variante/modelo
    const existente = carrinho.find(i => i.id === item.id && (i.variante || 'Padrão') === (item.variante || 'Padrão'));
    if (existente) {
        existente.qtd = (existente.qtd || 1) + (item.qtd || 1);
    } else {
        carrinho.push({ ...item, qtd: item.qtd || 1, selecionado: true });
    }
    salvarCarrinho(carrinho);
    if (typeof rastrearAdicionarCarrinho === 'function') rastrearAdicionarCarrinho(item);
    return true;
}

document.addEventListener('DOMContentLoaded', atualizarMenuUsuario);
