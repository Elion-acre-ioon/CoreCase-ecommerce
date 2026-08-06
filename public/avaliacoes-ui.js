(function () {
    const LIMITE_ARQUIVO = 60 * 1024 * 1024;
    let imagens = [];
    let videos = [];

    // Estado do visualizador estilo "stories"
    let storyMidias = [];   // [{tipo, arquivo}]
    let storyIndice = 0;

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

    /* ==========================================================================
     * VISUALIZADOR ESTILO "STORIES"
     * Ao clicar em qualquer mídia de um comentário, abre um overlay que já
     * começa reproduzindo o primeiro vídeo do comentário (se houver). O
     * cliente pode navegar para as imagens; o vídeo pausa ao sair dele e
     * retoma de onde parou ao voltar.
     * ========================================================================== */

    window.abrirStoryComentario = function (comentarioIndice, midiaIndiceClicado) {
        const comentario = (window.__comentariosCacheLoja || [])[comentarioIndice];
        if (!comentario || !comentario.midias || !comentario.midias.length) return;

        storyMidias = comentario.midias;
        // Prioriza abrir já no vídeo: se existir vídeo, começa nele; senão, começa na mídia clicada.
        const indiceVideo = storyMidias.findIndex(m => m.tipo === 'video');
        storyIndice = indiceVideo !== -1 ? indiceVideo : midiaIndiceClicado;

        document.getElementById('storyViewer').style.display = 'flex';
        document.body.style.overflow = 'hidden';
        renderizarStory();
    };

    function renderizarStory() {
        const overlay = document.getElementById('storyViewer');
        if (!overlay) return;

        const midia = storyMidias[storyIndice];
        const palco = document.getElementById('storyPalco');

        palco.innerHTML = midia.tipo === 'video'
            ? `<video id="storyVideo" src="${midia.arquivo}" autoplay playsinline controls></video>`
            : `<img src="${midia.arquivo}" alt="Mídia da avaliação">`;

        document.getElementById('storyBarras').innerHTML = storyMidias.map((_, i) => `
            <div class="story-barra ${i === storyIndice ? 'ativa' : ''} ${i < storyIndice ? 'concluida' : ''}"></div>
        `).join('');

        document.getElementById('storyAnterior').style.visibility = storyIndice === 0 ? 'hidden' : 'visible';
        document.getElementById('storyProximo').style.visibility = storyIndice === storyMidias.length - 1 ? 'hidden' : 'visible';
    }

    // Guarda o tempo de reprodução de cada vídeo (por URL) para retomar de onde parou ao voltar.
    const tempoVideos = {};

    function pausarVideoAtualSeHouver() {
        const video = document.getElementById('storyVideo');
        if (video) {
            tempoVideos[video.currentSrc || video.src] = video.currentTime;
            video.pause();
        }
    }

    window.storyIrPara = function (delta) {
        pausarVideoAtualSeHouver();
        const novoIndice = storyIndice + delta;
        if (novoIndice < 0 || novoIndice >= storyMidias.length) return;
        storyIndice = novoIndice;
        renderizarStory();

        // Se a nova mídia é o mesmo vídeo visitado antes, retoma de onde parou.
        const video = document.getElementById('storyVideo');
        if (video) {
            const retomarEm = tempoVideos[storyMidias[storyIndice].arquivo];
            if (retomarEm) {
                video.addEventListener('loadedmetadata', () => { video.currentTime = retomarEm; }, { once: true });
            }
        }
    };

    window.fecharStory = function (event) {
        if (event && event.target.closest('.story-palco') && event.target.tagName !== 'IMG') return;
        pausarVideoAtualSeHouver();
        document.getElementById('storyViewer').style.display = 'none';
        document.body.style.overflow = '';
    };

    document.addEventListener('keydown', e => {
        const overlay = document.getElementById('storyViewer');
        if (!overlay || overlay.style.display !== 'flex') return;
        if (e.key === 'Escape') fecharStory();
        if (e.key === 'ArrowRight') storyIrPara(1);
        if (e.key === 'ArrowLeft') storyIrPara(-1);
    });

    window.carregarAvaliacoes = async function () {
        const resposta = await fetch(`/api/produtos/${produtoAtual.id}/comentarios`);
        if (!resposta.ok) return;

        const dados = await resposta.json();
        window.__comentariosCacheLoja = dados.comentarios || [];
        const usuario = obterUsuarioLogado();
        const nota = dados.media?.nota || 0;
        const quantidade = dados.media?.quantidade || 0;

        const resumo = document.getElementById('notaProduto');
        if (resumo) {
            resumo.innerHTML = `${estrelas(nota)} ${Number(nota).toLocaleString('pt-BR', {
                minimumFractionDigits: 1, maximumFractionDigits: 1
            })} (${quantidade} avaliações)`;
        }

        const lista = window.__comentariosCacheLoja.length
            ? window.__comentariosCacheLoja.map((comentario, indiceComentario) => `
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
                        ${(comentario.midias || []).map((midia, indiceMidia) => `
                            <div class="midia-avaliacao-item" onclick="abrirStoryComentario(${indiceComentario}, ${indiceMidia})">
                                ${midia.tipo === 'video'
                                    ? `<video src="${midia.arquivo}" muted></video><span class="midia-play-icone">▶</span>`
                                    : `<img src="${midia.arquivo}" alt="Foto da avaliação">`
                                }
                            </div>
                        `).join('')}
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

        document.getElementById('comentariosProduto').innerHTML = lista + formulario + `
            <div id="storyViewer" class="story-viewer" onclick="fecharStory(event)">
                <div class="story-barras" id="storyBarras"></div>
                <button type="button" class="story-fechar" onclick="fecharStory()">×</button>
                <button type="button" id="storyAnterior" class="story-nav story-nav-esq" onclick="event.stopPropagation(); storyIrPara(-1)">‹</button>
                <div class="story-palco" id="storyPalco"></div>
                <button type="button" id="storyProximo" class="story-nav story-nav-dir" onclick="event.stopPropagation(); storyIrPara(1)">›</button>
            </div>
        `;
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
        .preview-midia img, .preview-midia video {
            width:100%; height:100%; object-fit:cover; border-radius:6px;
        }
        .preview-midia button { position:absolute; top:-7px; right:-7px; width:22px; height:22px; border:0;
            border-radius:50%; background:#c62828; color:#fff; cursor:pointer; }

        /* Separação bem visível entre um comentário e o próximo */
        .avaliacao {
            padding:22px 20px;
            margin-bottom:16px;
            border:1px solid #e5e7eb;
            border-radius:12px;
            background:#fff;
            box-shadow:0 1px 3px rgba(0,0,0,0.04);
        }
        .avaliacao-cabecalho { display:flex; gap:10px; align-items:center; }
        .avatar-avaliacao { width:38px; height:38px; border-radius:50%; object-fit:cover; }
        .estrelas-avaliacao { color:#c62828; font-size:14px; margin-top:3px; }

        .midia-avaliacao-item { position:relative; width:110px; height:110px; cursor:pointer; border-radius:6px; overflow:hidden; }
        .midia-avaliacao-item img, .midia-avaliacao-item video { width:100%; height:100%; object-fit:cover; display:block; }
        .midia-play-icone {
            position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
            width:34px; height:34px; border-radius:50%; background:rgba(0,0,0,0.55); color:#fff;
            display:flex; align-items:center; justify-content:center; font-size:14px; pointer-events:none;
        }

        /* Visualizador estilo stories */
        .story-viewer {
            display:none; position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:9999;
            align-items:center; justify-content:center; flex-direction:column;
        }
        .story-barras { position:absolute; top:14px; left:14px; right:14px; display:flex; gap:6px; z-index:2; }
        .story-barra { flex:1; height:3px; background:rgba(255,255,255,0.3); border-radius:2px; overflow:hidden; }
        .story-barra.concluida, .story-barra.ativa { background:#fff; }
        .story-fechar {
            position:absolute; top:14px; right:14px; z-index:3; background:transparent; border:0; color:#fff;
            font-size:28px; cursor:pointer; line-height:1;
        }
        .story-palco { max-width:92vw; max-height:86vh; display:flex; align-items:center; justify-content:center; }
        .story-palco img, .story-palco video { max-width:92vw; max-height:86vh; border-radius:8px; }
        .story-nav {
            position:absolute; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.15); color:#fff;
            border:0; width:44px; height:44px; border-radius:50%; font-size:26px; cursor:pointer; z-index:3;
        }
        .story-nav-esq { left:16px; }
        .story-nav-dir { right:16px; }
        @media (max-width:600px) {
            .story-nav { width:38px; height:38px; font-size:22px; }
        }
    `;
    document.head.appendChild(style);
})();
