(function () {
    let imagensAdmin = [];
    let videosAdmin = [];
    let comentarioEmEdicao = null; // id do comentário sendo editado, ou null = novo
    let enviando = false;

    function base64(arquivo) {
        return new Promise((resolve, reject) => {
            const leitor = new FileReader();
            leitor.onload = () => resolve(leitor.result);
            leitor.onerror = reject;
            leitor.readAsDataURL(arquivo);
        });
    }

    function validar(arquivos, limite) {
        if (arquivos.length > limite) throw new Error(`Limite de ${limite} arquivo(s) atingido.`);
        if (arquivos.some(x => x.size > 60 * 1024 * 1024)) {
            throw new Error('Cada arquivo pode ter no máximo 60 MB.');
        }
    }

    function desenharPreviaAdmin() {
        const destino = document.getElementById('resumoMidiasAdmin');
        if (!destino) return;
        const todas = [...imagensAdmin.map(a => ({ arquivo: a, tipo: 'imagem' })), ...videosAdmin.map(a => ({ arquivo: a, tipo: 'video' }))];

        if (!todas.length) { destino.innerHTML = '<p class="muted" style="margin:6px 0 0;">Nenhum arquivo novo selecionado.</p>'; return; }

        destino.innerHTML = `<div class="preview-midias-admin">${todas.map((item, indice) => {
            const url = URL.createObjectURL(item.arquivo);
            return `
                <div class="preview-midia-admin">
                    ${item.tipo === 'video' ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="Prévia">`}
                    <button type="button" onclick="removerMidiaAdminNova(${indice})">×</button>
                </div>
            `;
        }).join('')}</div>`;
    }

    window.removerMidiaAdminNova = function (indice) {
        // Recalcula o índice dentro da lista específica (imagens vêm antes dos vídeos no preview combinado)
        if (indice < imagensAdmin.length) {
            imagensAdmin.splice(indice, 1);
        } else {
            videosAdmin.splice(indice - imagensAdmin.length, 1);
        }
        desenharPreviaAdmin();
    };

    function formularioComentario(titulo, valores) {
        return `
            <div class="editor-comentario-admin">
                <h3>${titulo}</h3>
                <label>Usuário cadastrado (opcional)</label>
                <select id="comentarioUsuario">
                    <option value="">Nome e foto informados manualmente</option>
                    ${(window.__usuariosCacheAdmin || []).map(u => `<option value="${u.id}" ${String(valores.usuario_id) === String(u.id) ? 'selected' : ''}>${u.nome} — ${u.email}</option>`).join('')}
                </select>

                <label>Nome exibido</label>
                <input id="comentarioNome" type="text" placeholder="Ex.: Maria S." value="${(valores.nome_manual || '').replace(/"/g, '&quot;')}">

                <label>Foto do usuário (opcional)</label>
                <input id="comentarioFoto" type="file" accept="image/*">

                <label>Nota</label>
                <input id="comentarioNota" type="number" min="0" max="5" step="0.1" required value="${valores.nota ?? ''}">

                <label>Comentário</label>
                <textarea id="comentarioTexto" rows="5" required>${(valores.textoPuro || '')}</textarea>

                <label>Imagens — até 9 no total</label>
                <input type="file" accept="image/*" multiple onchange="adicionarMidiaAdmin(event, 'imagem')">

                <label>Vídeos — até 2 no total, com até 60 MB cada</label>
                <input type="file" accept="video/*" multiple onchange="adicionarMidiaAdmin(event, 'video')">

                <div id="resumoMidiasAdmin" class="muted"><p class="muted" style="margin:6px 0 0;">Nenhum arquivo novo selecionado.</p></div>

                ${valores.midiasExistentes && valores.midiasExistentes.length ? `
                    <label style="margin-top:14px;">Mídias já publicadas</label>
                    <div class="preview-midias-admin">
                        ${valores.midiasExistentes.map(m => `
                            <div class="preview-midia-admin">
                                ${m.tipo === 'video' ? `<video src="${m.arquivo}" muted></video>` : `<img src="${m.arquivo}" alt="Mídia">`}
                                <button type="button" onclick="apagarMidiaExistenteAdmin(${m.id}, this)">×</button>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div style="display:flex; gap:10px; margin-top:14px;">
                    <button type="button" class="btn-gravar" id="btnPublicarComentarioAdmin" onclick="publicarComentarioAdmin()">
                        ${comentarioEmEdicao ? 'Salvar alterações' : 'Publicar comentário'}
                    </button>
                    <button type="button" class="btn-neutro btn-pequeno" style="width:auto;" onclick="cancelarEdicaoComentarioAdmin()">Cancelar</button>
                </div>
            </div>
        `;
    }

    window.apagarMidiaExistenteAdmin = async function (midiaId, botao) {
        if (!confirm('Apagar este arquivo do comentário?')) return;
        const resposta = await adminFetch(`/api/comentarios/midias/${midiaId}`, { method: 'DELETE' });
        const dados = await resposta.json();
        if (!dados.sucesso) { alert('Não foi possível apagar o arquivo.'); return; }
        botao.closest('.preview-midia-admin').remove();
    };

    window.abrirEditorComentarioAdmin = async function () {
        const produtoId = document.getElementById('produtoId').value;
        if (!produtoId) {
            alert('Primeiro abra um produto para edição.');
            return;
        }

        if (!window.__usuariosCacheAdmin) {
            const resposta = await adminFetch('/api/usuarios');
            window.__usuariosCacheAdmin = await resposta.json();
        }

        comentarioEmEdicao = null;
        imagensAdmin = [];
        videosAdmin = [];
        document.getElementById('editorComentarioAdmin').innerHTML = formularioComentario('Novo comentário manual', {});
    };

    window.editarComentarioAdmin = function (comentarioId) {
        const comentario = (window.__comentariosCacheAdmin || []).find(c => c.id === comentarioId);
        if (!comentario) return;

        comentarioEmEdicao = comentarioId;
        imagensAdmin = [];
        videosAdmin = [];
        document.getElementById('editorComentarioAdmin').innerHTML = formularioComentario('Editar comentário', {
            usuario_id: comentario.usuario_id,
            nome_manual: comentario.nome_manual || comentario.nome || '',
            nota: comentario.nota,
            textoPuro: (comentario.texto || '').replace(/<br\s*\/?>/gi, '\n'),
            midiasExistentes: comentario.midias || []
        });
        document.getElementById('editorComentarioAdmin').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.cancelarEdicaoComentarioAdmin = function () {
        comentarioEmEdicao = null;
        imagensAdmin = [];
        videosAdmin = [];
        document.getElementById('editorComentarioAdmin').innerHTML = '';
    };

    window.excluirComentarioAdmin = async function (comentarioId) {
        if (!confirm('Apagar este comentário e todas as suas mídias?')) return;
        const produtoId = document.getElementById('produtoId').value;
        const resposta = await adminFetch(`/api/produtos/${produtoId}/comentarios/${comentarioId}`, { method: 'DELETE' });
        const dados = await resposta.json();
        if (!dados.sucesso) { alert('Não foi possível apagar o comentário.'); return; }
        carregarComentariosAdmin();
    };

    window.adicionarMidiaAdmin = function (event, tipo) {
        try {
            const arquivos = Array.from(event.target.files || []);
            const atual = tipo === 'imagem' ? imagensAdmin : videosAdmin;
            validar([...atual, ...arquivos], tipo === 'imagem' ? 9 : 2);

            if (tipo === 'imagem') imagensAdmin = [...imagensAdmin, ...arquivos];
            else videosAdmin = [...videosAdmin, ...arquivos];

            desenharPreviaAdmin();
            event.target.value = '';
        } catch (erro) {
            alert(erro.message);
            event.target.value = '';
        }
    };

    window.publicarComentarioAdmin = async function () {
        if (enviando) return; // trava contra duplo clique / envio duplicado
        const produtoId = document.getElementById('produtoId').value;
        const foto = document.getElementById('comentarioFoto').files[0];
        const nota = Number(document.getElementById('comentarioNota').value);
        const texto = document.getElementById('comentarioTexto').value.trim();

        if (!texto || nota < 0 || nota > 5) {
            alert('Informe a nota e o texto do comentário.');
            return;
        }

        const botao = document.getElementById('btnPublicarComentarioAdmin');
        enviando = true;
        if (botao) { botao.disabled = true; botao.textContent = 'Enviando...'; }

        try {
            const corpo = {
                usuario_id: document.getElementById('comentarioUsuario').value || null,
                nome_manual: document.getElementById('comentarioNome').value.trim(),
                nota,
                texto,
                imagens: await Promise.all(imagensAdmin.map(base64)),
                videos: await Promise.all(videosAdmin.map(base64))
            };
            if (foto) corpo.foto_manual = await base64(foto);

            const rota = comentarioEmEdicao
                ? `/api/produtos/${produtoId}/comentarios/${comentarioEmEdicao}`
                : `/api/produtos/${produtoId}/comentarios`;

            const resposta = await adminFetch(rota, {
                method: comentarioEmEdicao ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });

            const dados = await resposta.json();
            if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível salvar.');

            imagensAdmin = [];
            videosAdmin = [];
            comentarioEmEdicao = null;
            document.getElementById('editorComentarioAdmin').innerHTML = '';
            carregarComentariosAdmin();
        } catch (erro) {
            alert(erro.message);
        } finally {
            enviando = false;
            if (botao) { botao.disabled = false; botao.textContent = 'Publicar comentário'; }
        }
    };

    function estrelasAdmin(nota) {
        return Array.from({ length: 5 }, (_, i) => i < Math.round(Number(nota)) ? '★' : '☆').join('');
    }

    window.carregarComentariosAdmin = async function () {
        const produtoId = document.getElementById('produtoId').value;
        const lista = document.getElementById('listaComentariosAdmin');
        if (!produtoId || !lista) return;

        lista.innerHTML = '<p class="muted">Carregando comentários...</p>';
        const resposta = await fetch(`/api/produtos/${produtoId}/comentarios`);
        const dados = await resposta.json();
        window.__comentariosCacheAdmin = dados.comentarios || [];

        if (!window.__comentariosCacheAdmin.length) {
            lista.innerHTML = '<p class="muted">Nenhum comentário publicado ainda.</p>';
            return;
        }

        lista.innerHTML = window.__comentariosCacheAdmin.map(c => `
            <div class="comentario-admin-item">
                <div class="comentario-admin-cabecalho">
                    <div>
                        <strong>${c.nome}</strong>
                        <div class="estrelas-avaliacao">${estrelasAdmin(c.nota)} ${Number(c.nota).toFixed(1)}</div>
                    </div>
                    <div class="admin-actions">
                        <button type="button" class="btn-neutro btn-pequeno" style="width:auto;" onclick="editarComentarioAdmin(${c.id})">Editar</button>
                        <button type="button" class="btn-perigo btn-pequeno" style="width:auto;" onclick="excluirComentarioAdmin(${c.id})">Apagar</button>
                    </div>
                </div>
                <p>${c.texto || ''}</p>
                ${(c.midias || []).length ? `<div class="muted">${c.midias.length} arquivo(s) de mídia anexado(s)</div>` : ''}
            </div>
        `).join('');
    };
})();
