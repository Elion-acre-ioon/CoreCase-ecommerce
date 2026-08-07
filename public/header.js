(function () {
    function linkAtivo(path) {
        const atual = window.location.pathname;
        if (path === '/' && (atual === '/' || atual.endsWith('/index.html'))) return 'ativo';
        if (path !== '/' && atual.endsWith(path)) return 'ativo';
        return '';
    }

    function htmlHeader() {
        return `
            <header class="header-principal core-header" role="banner">
                <div class="logo">
                    <a class="logo-text-header" href="/" aria-label="Core Case - inicio">CORE CASE</a>
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

    function normalizarHeader() {
        const existente = document.querySelector('.header-principal');
        if (existente) {
            existente.outerHTML = htmlHeader();
        } else {
            document.body.insertAdjacentHTML('afterbegin', htmlHeader());
        }
        if (typeof atualizarMenuUsuario === 'function') atualizarMenuUsuario();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', normalizarHeader);
    } else {
        normalizarHeader();
    }
})();
