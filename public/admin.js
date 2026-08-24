function usuarioAdminAtual() {
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario_logado') || 'null');
        return usuario && Number(usuario.is_admin) === 1 ? usuario : null;
    } catch (e) {
        return null;
    }
}

function exigirAdmin() {
    const admin = usuarioAdminAtual();
    if (!admin) {
        localStorage.setItem('redirecionar_depois', window.location.pathname);
        window.location.href = '/login.html';
        return null;
    }
    return admin;
}

function montarNavAdmin(abaAtiva) {
    const admin = exigirAdmin();
    if (!admin) return;

    const nav = document.createElement('nav');
    nav.className = 'nav-admin';
    nav.innerHTML = `
        <h1>CORE CASE Admin</h1>
        <div class="nav-links">
            <a href="/loja.html" style="background:#10b981; color:white;">🏪 Ver Loja</a>
            <a href="/admin-loja.html" class="${abaAtiva === 'loja' ? 'active' : ''}">Loja</a>
            <details class="admin-nav-grupo"><summary class="${['fila','analise','financeiro','usuarios'].includes(abaAtiva) ? 'active' : ''}">Operação</summary><div><a href="/admin-servicos.html" class="${abaAtiva === 'fila' ? 'active' : ''}">Fila</a><a href="/admin-analise.html" class="${abaAtiva === 'analise' ? 'active' : ''}">Análise</a><a href="/admin-financeiro.html" class="${abaAtiva === 'financeiro' ? 'active' : ''}">Financeiro</a><a href="/admin-usuarios.html" class="${abaAtiva === 'usuarios' ? 'active' : ''}">Usuários</a></div></details>
            <details class="admin-nav-grupo"><summary class="${['vitrine','produtos','categorias'].includes(abaAtiva) ? 'active' : ''}">Catálogo / Loja</summary><div><a href="/admin-vitrine.html" class="${abaAtiva === 'vitrine' ? 'active' : ''}">Vitrine</a><a href="/admin-produtos.html" class="${abaAtiva === 'produtos' ? 'active' : ''}">Produtos</a><a href="/admin-categorias.html" class="${abaAtiva === 'categorias' ? 'active' : ''}">Categorias</a></div></details>
            <button class="btn-sair-admin" onclick="sairAdmin()">Sair</button>
        </div>
    `;
    document.body.prepend(nav);
}

async function sairAdmin() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    localStorage.removeItem('usuario_logado');
    window.location.href = '/index.html';
}

async function adminFetch(url, opcoes = {}) {
    const headers = { ...(opcoes.headers || {}) };

    const resposta = await fetch(url, { ...opcoes, headers, credentials: 'include' });
    if (resposta.status === 403) {
        localStorage.setItem('redirecionar_depois', window.location.pathname);
        window.location.href = '/login.html';
        throw new Error('Acesso administrativo expirado.');
    }

    return resposta;
}

function primeiraFotoProduto(produto) {
    try {
        const fotos = JSON.parse(produto.foto || '[]');
        return Array.isArray(fotos) && fotos.length ? fotos[0] : produto.foto;
    } catch (e) {
        return produto.foto || 'https://via.placeholder.com/450?text=Core+Case';
    }
}

function moeda(valor) {
    return Number(valor || 0).toFixed(2);
}
