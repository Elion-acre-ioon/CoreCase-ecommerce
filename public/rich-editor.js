(function () {
    const escapeHtml = (text) => String(text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    window.iniciarEditorRico = function (textareaId) {
        const textarea = document.getElementById(textareaId);
        if (!textarea || textarea.dataset.editorPronto) return;

        textarea.dataset.editorPronto = 'true';
        const eraObrigatorio = textarea.required;
        if (eraObrigatorio) textarea.required = false;
        textarea.style.display = 'none';

        const area = document.createElement('div');
        area.className = 'editor-rico-area';
        area.contentEditable = 'true';
        area.setAttribute('role', 'textbox');
        area.setAttribute('aria-label', textarea.previousElementSibling?.textContent || 'Editor de texto');
        if (eraObrigatorio) area.setAttribute('aria-required', 'true');

        const valor = textarea.value || '';
        area.innerHTML = /<[a-z][\s\S]*>/i.test(valor)
            ? valor
            : escapeHtml(valor).replace(/\n/g, '<br>');

        const barra = document.createElement('div');
        barra.className = 'editor-rico-barra';
        barra.innerHTML = `
            <button type="button" data-comando="bold" title="Negrito"><b>B</b></button>
            <button type="button" data-comando="italic" title="Itálico"><i>I</i></button>
            <button type="button" data-comando="underline" title="Sublinhado"><u>U</u></button>
            <button type="button" data-comando="insertUnorderedList" title="Lista">• Lista</button>
            <button type="button" data-comando="insertOrderedList" title="Lista numerada">1. Lista</button>
            <button type="button" data-bloco="h3" title="Título">Título</button>
            <button type="button" data-bloco="p" title="Texto normal">Texto</button>
            <button type="button" data-emoji="😊">😊</button>
            <button type="button" data-emoji="⭐">⭐</button>
            <button type="button" data-emoji="✅">✅</button>
            <button type="button" data-emoji="📦">📦</button>
        `;

        function sincronizar() {
            textarea.value = area.innerHTML;
        }

        barra.addEventListener('mousedown', (event) => event.preventDefault());
        barra.addEventListener('click', (event) => {
            const botao = event.target.closest('button');
            if (!botao) return;

            area.focus();

            if (botao.dataset.comando) {
                document.execCommand(botao.dataset.comando, false, null);
            }
            if (botao.dataset.bloco) {
                document.execCommand('formatBlock', false, botao.dataset.bloco);
            }
            if (botao.dataset.emoji) {
                document.execCommand('insertText', false, botao.dataset.emoji);
            }
            sincronizar();
        });

        area.addEventListener('input', sincronizar);
        textarea.parentNode.insertBefore(barra, textarea);
        textarea.parentNode.insertBefore(area, textarea);

        const formulario = textarea.closest('form');
        if (formulario) formulario.addEventListener('submit', sincronizar);
        textarea._editorRicoArea = area;
        textarea._sincronizarEditorRico = sincronizar;
    };

    window.obterConteudoEditorRico = function (id) {
        const campo = document.getElementById(id);
        if (!campo) return '';
        if (campo._sincronizarEditorRico) campo._sincronizarEditorRico();
        return campo.value || '';
    };

    window.editorRicoTemConteudo = function (id) {
        const campo = document.getElementById(id);
        const area = campo?._editorRicoArea;
        if (!area) return Boolean(String(campo?.value || '').trim());
        return Boolean(String(area.textContent || '').replace(/\u00a0/g, ' ').trim());
    };

    window.focarEditorRico = function (id) {
        document.getElementById(id)?._editorRicoArea?.focus();
    };

    window.atualizarEditorRico = function (id, valor) {
        const campo = document.getElementById(id);
        if (!campo) return;
        campo.value = valor || '';
        if (!campo._editorRicoArea) return;
        campo._editorRicoArea.innerHTML = /<[a-z][\s\S]*>/i.test(campo.value)
            ? campo.value
            : escapeHtml(campo.value).replace(/\n/g, '<br>');
    };

    const style = document.createElement('style');
    style.textContent = `
        .editor-rico-barra {
            display:flex; flex-wrap:wrap; gap:6px; padding:8px;
            border:1px solid #cbd5e1; border-bottom:0;
            border-radius:8px 8px 0 0; background:#f8fafc;
        }
        .editor-rico-barra button {
            width:auto; margin:0; padding:6px 9px; border:1px solid #cbd5e1;
            border-radius:5px; background:#fff; color:#1e293b; cursor:pointer;
        }
        .editor-rico-barra button:hover { background:#fee2e2; border-color:#c62828; }
        .editor-rico-area {
            min-height:120px; padding:12px; border:1px solid #cbd5e1;
            border-radius:0 0 8px 8px; background:#fff; outline:none;
            line-height:1.6; font-family:Arial, sans-serif;
        }
        .editor-rico-area:focus { border-color:#c62828; box-shadow:0 0 0 3px rgba(198,40,40,.12); }
        .editor-rico-area h3 { margin:12px 0 6px; }
    `;
    document.head.appendChild(style);
})();
