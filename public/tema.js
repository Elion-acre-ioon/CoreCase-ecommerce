(function () {
    'use strict';

    const CHAVE_TEMA = 'corecase_theme';
    const CHAVE_USUARIO = 'corecase_theme_user';

    function normalizar(theme) {
        return theme === 'dark' || theme === 'light' ? theme : null;
    }

    function usuarioLocal() {
        try {
            const usuario = JSON.parse(localStorage.getItem('usuario_logado') || 'null');
            return usuario && usuario.id != null ? usuario : null;
        } catch (e) {
            return null;
        }
    }

    function aplicar(theme, animar) {
        const temaValido = normalizar(theme) || 'light';
        const raiz = document.documentElement;
        if (animar) raiz.classList.add('tema-em-transicao');
        raiz.dataset.theme = temaValido;
        if (animar) window.setTimeout(() => raiz.classList.remove('tema-em-transicao'), 240);
        return temaValido;
    }

    function limpar() {
        localStorage.removeItem(CHAVE_TEMA);
        localStorage.removeItem(CHAVE_USUARIO);
        aplicar('light');
    }

    function confirmarUsuario(usuario) {
        if (!usuario || usuario.id == null) {
            limpar();
            return 'light';
        }
        const theme = normalizar(usuario.theme) || 'light';
        localStorage.setItem(CHAVE_TEMA, theme);
        localStorage.setItem(CHAVE_USUARIO, String(usuario.id));
        return aplicar(theme);
    }

    const usuario = usuarioLocal();
    if (!usuario) {
        limpar();
    } else {
        const donoCache = localStorage.getItem(CHAVE_USUARIO);
        const temaCache = normalizar(localStorage.getItem(CHAVE_TEMA));
        const temaUsuario = normalizar(usuario.theme);
        aplicar(donoCache === String(usuario.id) && temaCache ? temaCache : (temaUsuario || 'light'));
    }

    window.CoreCaseTema = { aplicar, confirmarUsuario, limpar, normalizar };
})();
