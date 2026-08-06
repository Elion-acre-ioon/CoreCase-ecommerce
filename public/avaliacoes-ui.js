(function () {
    const LIMITE_ARQUIVO = 60 * 1024 * 1024;
    let imagens = [];
    let videos = [];

    function escapar(texto) {
        return String(texto || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[c]));
    }

    function estrelas(nota) {
        return Array.from({ length: 5 }, (_, i) => i < Math.round(Number(nota)) ? '★' : '☆').join('');
    }

    function paraBase64(arquivo) {
        return new Promise((resolve, reject) => {
            const leitor = new FileReader();
            leitor.onload = () => resolve(leitor.result);
            leitor.onerror = reject;
            leitor.readAsDataURL(arquivo);
        });
    }

    function validarArquivos(lista, tipo) {
        const limite = tipo === 'imagem' ? 9 : 2;

        if (lista.length > limite) {
            throw new Error(`Você pode enviar no máximo ${limite} ${tipo === 'imagem' ? 'imagens' : 'vídeos'}.`);
        }

        if (lista.some(arquivo => arquivo.size > LIMITE_ARQUIVO)) {
            throw new Error('Cada imagem ou vídeo pode ter no máximo 60 MB. Reduza o tamanho do arquivo e tente novamente.');
        }
    }

    function desenharPrevia() {
        const destino = document.getElementById('previewMidiasAvaliacao');
        if (!destino) return;

        destino.innerHTML = [...imagens, ...videos].map((arquivo, indice) => {
            const video = arquivo.type.startsWith('video/');
            const url = URL.createObjectURL(arquivo);

            return `
                <div class="preview-midia">
                    ${video
                        ? `<video src="${url}" muted></video>`
                        : `<img src="${url}" alt="Prévia da imagem">`}
                    <button type="button" onclick="removerMidiaAvaliacao(${indice})">×</button>
                </div>
            `;
        }).join('');
    }

    window.removerMidiaAvaliacao = function (indice) {
        const todas = [...imagens, ...videos];
        const item = todas[indice];

        if (imagens.includes(item)) imagens = imagens.filter(x => x !== item);
        else videos = videos.filter(x => x !== item);

        desenharPrevia();
    };

    window.receberMidiasAvaliacao = function (event, tipo) {
        try {
            const novos = Array.from(event.target.files || []);
            const atual = tipo === 'imagem' ? imagens : videos;
            validarArquivos([...atual, ...novos], tipo);

            if (tipo === 'imagem') imagens = [...imagens, ...novos];
            else videos = [...videos, ...novos];

            event.target.value = '';
            desenharPrevia();
        } catch (erro) {
            event.target.value = '';
            alert(erro.message);
        }
    };

    window.enviarAvaliacaoCompleta = async function (event) {
        event.preventDefault();

        const usuario = obterUsuarioLogado();
        if (!usuario) {
            window.location.href = '/login.html';
            return;
        }

        const nota = Number(document.getElementById('novaNota').value);
        const texto = document.getElementById('novoTexto').value.trim();

        if (!texto || nota < 0 || nota > 5) {
            alert('Informe uma nota entre 0 e 5 e escreva sua avaliação.');
            return;
        }

        const botao = event.target.querySelector('button[type="submit"]');
        botao.disabled = true;
        botao.textContent = 'Publicando...';

        try {
            const resposta = await fetch(`/api/produtos/${produtoAtual.id}/comentarios`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Token': localStorage.getItem('userToken') || ''
                },
                body: JSON.stringify({
                    usuario_id: usuario.id,
                    nota,
                    texto,
                    imagens: await Promise.all(imagens.map(paraBase64)),
                    videos: await Promise.all(videos.map(paraBase64))
                })
            });

            const dados = await resposta.json();
            if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível publicar a avaliação.');

            imagens = [];
            videos = [];
            carregarAvaliacoes();
        } catch (erro) {
            alert(erro.message);
        } finally {
            botao.disabled = false;
            botao.textContent = 'Publicar avaliação';
        }
    };

    window.carregarAvaliacoes = async function () {
        const resposta = await fetch(`/api/produtos/${produtoAtual.id}/comentarios`);
        if (!resposta.ok) return;

        const dados = await resposta.json();
        const usuario = obterUsuarioLogado();
        const nota = dados.media?.nota || 0;
        const quantidade = dados.media?.quantidade || 0;

        const resumo = document.getElementById('notaProduto');
        if (resumo) {
            resumo.innerHTML = `${estrelas(nota)} ${Number(nota).toLocaleString('pt-BR', {
                minimumFractionDigits: 1, maximumFractionDigits: 1
            })} (${quantidade} avaliações)`;
        }

        const lista = dados.comentarios.length
            ? dados.comentarios.map(comentario => `
                <article class="avaliacao">
                    <div class="avaliacao-cabecalho">
                        ${comentario.foto ? `<img src="${comentario.foto}" class="avatar-avaliacao" alt="">` : ''}
                        <div>
                            <b>${escapar(comentario.nome)}</b>
                            <div class="estrelas-avaliacao">${estrelas(comentario.nota)}
                                ${Number(comentario.nota).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}
                            </div>
                        </div>
                    </div>
                    <p>${comentario.texto || ''}</p>
                    <div class="midias-avaliacao">
                        ${(comentario.midias || []).map(midia => midia.tipo === 'video'
                            ? `<video controls src="${midia.arquivo}"></video>`
                            : `<img src="${midia.arquivo}" alt="Foto da avaliação">`
                        ).join('')}
                    </div>
                </article>
            `).join('')
            : '<p>Ainda não há avaliações. Seja a primeira pessoa a avaliar este produto.</p>';

        const formulario = usuario ? `
            <form class="form-avaliacao" onsubmit="enviarAvaliacaoCompleta(event)">
                <h3>Deixe sua avaliação</h3>
                <label>Nota de 0 a 5</label>
                <input id="novaNota" type="number" min="0" max="5" step="0.1" required>

                <label>Conte sua experiência</label>
                <textarea id="novoTexto" required maxlength="5000"></textarea>

                <div class="botoes-upload">
                    <label class="botao-upload">
                        Adicionar imagens
                        <input type="file" accept="image/*" multiple
                               onchange="receberMidiasAvaliacao(event, 'imagem')">
                    </label>
                    <label class="botao-upload">
                        Adicionar vídeos
                        <input type="file" accept="video/*" multiple
                               onchange="receberMidiasAvaliacao(event, 'video')">
                    </label>
                </div>
                <small>Até 9 imagens e 2 vídeos. Cada arquivo pode ter até 60 MB.</small>
                <div id="previewMidiasAvaliacao" class="preview-midias"></div>
                <button type="submit" class="btn-comprar">Publicar avaliação</button>
            </form>
        ` : '<p><a href="/login.html">Faça login</a> para avaliar este produto.</p>';

        document.getElementById('comentariosProduto').innerHTML = lista + formulario;
    };

    const style = document.createElement('style');
    style.textContent = `
        .form-avaliacao { margin-top:28px; padding-top:22px; border-top:1px solid #e5e5e5; }
        .form-avaliacao label { display:block; margin:13px 0 6px; font-weight:600; }
        .form-avaliacao input, .form-avaliacao textarea {
            width:100%; padding:10px; border:1px solid #d1d5db; border-radius:6px; font:inherit;
        }
        .form-avaliacao textarea { min-height:100px; resize:vertical; }
        .botoes-upload { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
        .botao-upload { display:inline-block !important; width:auto; margin:0 !important; padding:9px 12px;
            background:#fef2f2; color:#b91c1c; border:1px dashed #c62828; border-radius:6px; cursor:pointer; }
        .botao-upload input { display:none; }
        .preview-midias, .midias-avaliacao { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
        .preview-midia { width:90px; height:90px; position:relative; }
        .preview-midia img, .preview-midia video, .midias-avaliacao img, .midias-avaliacao video {
            width:100%; height:100%; object-fit:cover; border-radius:6px;
        }
        .preview-midia button { position:absolute; top:-7px; right:-7px; width:22px; height:22px; border:0;
            border-radius:50%; background:#c62828; color:#fff; cursor:pointer; }
        .avaliacao { padding:20px 0; border-top:1px solid #e5e5e5; }
        .avaliacao-cabecalho { display:flex; gap:10px; align-items:center; }
        .avatar-avaliacao { width:38px; height:38px; border-radius:50%; object-fit:cover; }
        .estrelas-avaliacao { color:#c62828; font-size:14px; margin-top:3px; }
        .midias-avaliacao img, .midias-avaliacao video { width:110px; height:110px; }
    `;
    document.head.appendChild(style);
})();