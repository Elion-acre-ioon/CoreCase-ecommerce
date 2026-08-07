(function () {
    const MENU_ID = 'headerCategoriasMenu';
    const BOTAO_ID = 'headerCategoriasBtn';

    function linkAtivo(path) {
        const atual = window.location.pathname;
        if (path === '/' && (atual === '/' || atual.endsWith('/index.html'))) return 'ativo';
        if (path !== '/' && atual.endsWith(path)) return 'ativo';
        return '';
    }

    function estaNaLoja() {
        const path = window.location.pathname;
        return path.endsWith('/loja.html');
    }

    function htmlCategoriasLoja() {
        if (!estaNaLoja()) return '';
        return `
            <div class="header-categorias-desktop">
                <button type="button" class="header-categorias-btn" id="${BOTAO_ID}" aria-expanded="false" aria-controls="${MENU_ID}">
                    Categorias <span aria-hidden="true">▾</span>
                </button>
                <div class="header-categorias-menu" id="${MENU_ID}" hidden>
                    <div class="header-categorias-titulo">Categorias</div>
                    <div id="headerCategoriasLista">
                        <button type="button" class="header-categoria-item" disabled>Carregando...</button>
                    </div>
                </div>
            </div>
        `;
    }

    function htmlHeader() {
        return `
            <header class="header-principal core-header" role="banner">
                <div class="header-left">
                    <div class="logo">
                        <a class="logo-text-header" href="/" aria-label="Core Case - inicio">CORE CASE</a>
                    </div>
                    ${htmlCategoriasLoja()}
                </div>
                <nav class="nav-principal" aria-label="Navegacao principal">
                    <a href="/" class="${linkAtivo('/')}">Home</a>
                    <a href="/loja.html" class="${linkAtivo('/loja.html')}">Loja</a>
                    <a href="/cart.html" class="${linkAtivo('/cart.html')}">Carrinho</a>
                    <div id="menu-usuario"></div>
                </nav>
            </header>
        `;
    }

    function categoriaAtual() {
        return new URLSearchParams(window.location.search).get('categoria') || 'todos';
    }

    function escaparHtml(valor) {
        const div = document.createElement('div');
        div.textContent = valor == null ? '' : String(valor);
        return div.innerHTML;
    }

    function selecionarCategoriaHeader(slug) {
        if (typeof window.selecionarCategoria === 'function') {
            window.selecionarCategoria(slug);
        } else {
            const params = new URLSearchParams(window.location.search);
            if (!slug || slug === 'todos') params.delete('categoria');
            else params.set('categoria', slug);
            const qs = params.toString();
            window.location.href = qs ? `/loja.html?${qs}` : '/loja.html';
        }
        fecharMenuCategorias();
        atualizarCategoriasAtivas();
    }

    function itemCategoria(cat) {
        const slug = cat.slug || 'todos';
        const ativa = categoriaAtual() === slug || (categoriaAtual() === 'todos' && slug === 'todos');
        const img = cat.imagem_url
            ? `<img src="${escaparHtml(cat.imagem_url)}" alt="" class="header-categoria-thumb" loading="lazy" decoding="async">`
            : `<span class="header-categoria-placeholder" aria-hidden="true">${escaparHtml(String(cat.nome || '?').trim().charAt(0) || '?')}</span>`;
        return `
            <button type="button" class="header-categoria-item ${ativa ? 'ativa' : ''}" data-slug="${escaparHtml(slug)}" aria-pressed="${ativa}">
                ${img}
                <span class="header-categoria-nome">${escaparHtml(cat.nome || 'Categoria')}</span>
                <span class="header-categoria-qtd">${Number(cat.produtos || 0)}</span>
            </button>
        `;
    }

    function atualizarCategoriasAtivas() {
        const lista = document.getElementById('headerCategoriasLista');
        if (!lista) return;
        const todosQtd = lista.querySelector('.header-categoria-item[data-slug="todos"] .header-categoria-qtd');
        if (todosQtd && Number.isFinite(Number(window.coreCaseProdutosCount))) {
            todosQtd.textContent = Number(window.coreCaseProdutosCount);
        }
        lista.querySelectorAll('.header-categoria-item[data-slug]').forEach(botao => {
            const slug = botao.getAttribute('data-slug');
            const ativa = categoriaAtual() === slug || (categoriaAtual() === 'todos' && slug === 'todos');
            botao.classList.toggle('ativa', ativa);
            botao.setAttribute('aria-pressed', String(ativa));
        });
    }

    async function carregarCategoriasHeader() {
        const lista = document.getElementById('headerCategoriasLista');
        if (!lista || !estaNaLoja()) return;
        if (Array.isArray(window.coreCaseCategorias)) {
            renderizarCategoriasHeader(window.coreCaseCategorias);
            return;
        }
        let carregouPorEvento = false;
        const aguardarBootstrap = () => {
            if (!Array.isArray(window.coreCaseCategorias)) return;
            carregouPorEvento = true;
            renderizarCategoriasHeader(window.coreCaseCategorias);
        };
        window.addEventListener('corecase:categorias-carregadas', aguardarBootstrap, { once: true });
        setTimeout(async () => {
            if (carregouPorEvento || Array.isArray(window.coreCaseCategorias)) {
                aguardarBootstrap();
                return;
            }
            try {
                const res = await fetch('/api/categorias');
                const categorias = await res.json();
                renderizarCategoriasHeader(Array.isArray(categorias) ? categorias : []);
            } catch (erro) {
                lista.innerHTML = '<button type="button" class="header-categoria-item" disabled>Nao foi possivel carregar.</button>';
            }
        }, 1500);
    }

    function renderizarCategoriasHeader(categorias) {
        const lista = document.getElementById('headerCategoriasLista');
        if (!lista) return;
        try {
            const todas = [{ nome: 'Todos', slug: 'todos', produtos: window.produtos?.length || 0 }, ...(Array.isArray(categorias) ? categorias : [])];
            lista.innerHTML = todas.map(itemCategoria).join('');
            lista.querySelectorAll('.header-categoria-item[data-slug]').forEach(botao => {
                botao.addEventListener('click', () => selecionarCategoriaHeader(botao.getAttribute('data-slug') || 'todos'));
            });
        } catch (erro) {
            lista.innerHTML = '<button type="button" class="header-categoria-item" disabled>Nao foi possivel carregar.</button>';
        }
    }

    function abrirMenuCategorias() {
        const botao = document.getElementById(BOTAO_ID);
        const menu = document.getElementById(MENU_ID);
        if (!botao || !menu) return;
        menu.hidden = false;
        botao.setAttribute('aria-expanded', 'true');
        atualizarCategoriasAtivas();
    }

    function fecharMenuCategorias() {
        const botao = document.getElementById(BOTAO_ID);
        const menu = document.getElementById(MENU_ID);
        if (!botao || !menu) return;
        menu.hidden = true;
        botao.setAttribute('aria-expanded', 'false');
    }

    function alternarMenuCategorias() {
        const menu = document.getElementById(MENU_ID);
        if (!menu) return;
        if (menu.hidden) abrirMenuCategorias();
        else fecharMenuCategorias();
    }

    function configurarCategoriasHeader() {
        const botao = document.getElementById(BOTAO_ID);
        if (!botao || !estaNaLoja()) return;
        botao.addEventListener('click', event => {
            event.stopPropagation();
            alternarMenuCategorias();
        });
        document.addEventListener('click', event => {
            const menu = document.getElementById(MENU_ID);
            if (!menu || menu.hidden) return;
            if (!event.target.closest('.header-categorias-desktop')) fecharMenuCategorias();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') fecharMenuCategorias();
        });
        window.addEventListener('popstate', atualizarCategoriasAtivas);
        window.addEventListener('corecase:categoria-alterada', atualizarCategoriasAtivas);
        window.addEventListener('corecase:produtos-carregados', atualizarCategoriasAtivas);
        carregarCategoriasHeader();
    }

    function normalizarHeader() {
        const existente = document.querySelector('.header-principal');
        if (existente) {
            existente.outerHTML = htmlHeader();
        } else {
            document.body.insertAdjacentHTML('afterbegin', htmlHeader());
        }
        configurarCategoriasHeader();
        if (typeof atualizarMenuUsuario === 'function') atualizarMenuUsuario();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', normalizarHeader);
    } else {
        normalizarHeader();
    }
})();
