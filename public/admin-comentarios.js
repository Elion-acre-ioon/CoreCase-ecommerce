(function () {
    let imagensAdmin = [];
    let videosAdmin = [];

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

    window.abrirEditorComentarioAdmin = async function () {
        const produtoId = document.getElementById('produtoId').value;
        if (!produtoId) {
            alert('Primeiro abra um produto para edição.');
            return;
        }

        const resposta = await adminFetch('/api/usuarios');
        const usuarios = await resposta.json();

        document.getElementById('editorComentarioAdmin').innerHTML = `
            <div class="editor-comentario-admin">
                <h3>Novo comentário manual</h3>
                <label>Usuário cadastrado (opcional)</label>
                <select id="comentarioUsuario">
                    <option value="">Nome e foto informados manualmente</option>
                    ${usuarios.map(u => `<option value="${u.id}">${u.nome} — ${u.email}</option>`).join('')}
                </select>

                <label>Nome exibido</label>
                <input id="comentarioNome" type="text" placeholder="Ex.: Maria S.">

                <label>Foto do usuário (opcional)</label>
                <input id="comentarioFoto" type="file" accept="image/*">

                <label>Nota</label>
                <input id="comentarioNota" type="number" min="0" max="5" step="0.1" required>

                <label>Comentário</label>
                <textarea id="comentarioTexto" rows="5" required></textarea>

                <label>Imagens — até 9</label>
                <input type="file" accept="image/*" multiple onchange="adicionarMidiaAdmin(event, 'imagem')">

                <label>Vídeos — até 2, com até 60 MB cada</label>
                <input type="file" accept="video/*" multiple onchange="adicionarMidiaAdmin(event, 'video')">

                <div id="resumoMidiasAdmin" class="muted"></div>
                <button type="button" class="btn-gravar" onclick="publicarComentarioAdmin()">Publicar comentário</button>
            </div>
        `;
    };

    window.adicionarMidiaAdmin = function (event, tipo) {
        try {
            const arquivos = Array.from(event.target.files || []);
            const atual = tipo === 'imagem' ? imagensAdmin : videosAdmin;
            validar([...atual, ...arquivos], tipo === 'imagem' ? 9 : 2);

            if (tipo === 'imagem') imagensAdmin = [...imagensAdmin, ...arquivos];
            else videosAdmin = [...videosAdmin, ...arquivos];

            document.getElementById('resumoMidiasAdmin').textContent =
                `${imagensAdmin.length} imagem(ns) e ${videosAdmin.length} vídeo(s) selecionados.`;
            event.target.value = '';
        } catch (erro) {
            alert(erro.message);
            event.target.value = '';
        }
    };

    window.publicarComentarioAdmin = async function () {
        const produtoId = document.getElementById('produtoId').value;
        const foto = document.getElementById('comentarioFoto').files[0];
        const nota = Number(document.getElementById('comentarioNota').value);
        const texto = document.getElementById('comentarioTexto').value.trim();

        if (!texto || nota < 0 || nota > 5) {
            alert('Informe a nota e o texto do comentário.');
            return;
        }

        try {
            const resposta = await adminFetch(`/api/produtos/${produtoId}/comentarios`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: document.getElementById('comentarioUsuario').value || null,
                    nome_manual: document.getElementById('comentarioNome').value.trim(),
                    foto_manual: foto ? await base64(foto) : null,
                    nota,
                    texto,
                    imagens: await Promise.all(imagensAdmin.map(base64)),
                    videos: await Promise.all(videosAdmin.map(base64))
                })
            });

            const dados = await resposta.json();
            if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível publicar.');

            imagensAdmin = [];
            videosAdmin = [];
            document.getElementById('editorComentarioAdmin').innerHTML =
                '<p class="muted">Comentário publicado com sucesso.</p>';
        } catch (erro) {
            alert(erro.message);
        }
    };
})();