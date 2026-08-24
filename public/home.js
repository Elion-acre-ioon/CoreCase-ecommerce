(function () {
    const estado = {
        destaques: [],
        indice: 0,
        timer: null,
        pausado: false,
        toqueInicioX: null,
        intervaloMs: 7000
    };

    function porId(id) {
        return document.getElementById(id);
    }

    function imagemCloudinary(url, largura) {
        const valor = String(url || '');
        if (!valor.includes('res.cloudinary.com') || !valor.includes('/upload/')) return valor;
        return valor.replace('/upload/', `/upload/f_auto,q_auto,c_limit,w_${largura}/`);
    }

    function criarImagemDestaque(item) {
        const picture = document.createElement('picture');
        if (item.imagem_mobile) {
            const source = document.createElement('source');
            source.media = '(max-width: 600px)';
            source.srcset = imagemCloudinary(item.imagem_mobile, 900);
            picture.appendChild(source);
        }
        const imagem = document.createElement('img');
        imagem.src = imagemCloudinary(item.imagem_desktop, 1600);
        imagem.alt = item.produto_nome ? `Oferta: ${item.produto_nome}` : 'Oferta Core Case';
        imagem.width = 1910;
        imagem.height = 1000;
        imagem.loading = 'eager';
        imagem.fetchPriority = 'high';
        imagem.decoding = 'async';
        picture.appendChild(imagem);
        return picture;
    }

    function renderizarDestaque() {
        const item = estado.destaques[estado.indice];
        const hero = porId('homeHero');
        if (!item || !hero) return;

        const link = document.createElement('a');
        link.className = 'home-banner';
        link.href = `/produto.html?id=${encodeURIComponent(item.produto_id)}`;
        link.setAttribute('aria-label', `Ver produto ${item.produto_nome || ''}`.trim());
        link.appendChild(criarImagemDestaque(item));

        const cta = document.createElement('span');
        cta.className = 'home-banner-cta';
        cta.textContent = 'Ver mais';
        link.appendChild(cta);
        hero.replaceChildren(link);

        porId('homeSeletor')?.querySelectorAll('button').forEach((botao, indice) => {
            const ativo = indice === estado.indice;
            botao.setAttribute('aria-current', String(ativo));
            botao.setAttribute('aria-label', `${ativo ? 'Destaque atual' : 'Mostrar destaque'}: ${estado.destaques[indice].produto_nome}`);
        });
    }

    function selecionarDestaque(indice, manual) {
        if (!estado.destaques.length) return;
        estado.indice = (indice + estado.destaques.length) % estado.destaques.length;
        renderizarDestaque();
        if (manual) reiniciarRotacao();
    }

    function criarSeletor() {
        const seletor = porId('homeSeletor');
        if (!seletor) return;
        seletor.replaceChildren();
        if (estado.destaques.length <= 1) return;
        estado.destaques.forEach((item, indice) => {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.textContent = item.produto_nome || `Destaque ${indice + 1}`;
            botao.addEventListener('click', () => selecionarDestaque(indice, true));
            seletor.appendChild(botao);
        });
    }

    function pararRotacao() {
        if (estado.timer) window.clearInterval(estado.timer);
        estado.timer = null;
    }

    function iniciarRotacao() {
        pararRotacao();
        if (estado.pausado || estado.destaques.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        estado.timer = window.setInterval(() => selecionarDestaque(estado.indice + 1, false), estado.intervaloMs);
    }

    function reiniciarRotacao() {
        pararRotacao();
        iniciarRotacao();
    }

    function configurarInteracaoDestaques() {
        const secao = porId('homeDestaques');
        if (!secao) return;
        const multiplos = estado.destaques.length > 1;
        porId('homeAnterior').hidden = !multiplos;
        porId('homeProximo').hidden = !multiplos;
        if (!multiplos) return;
        porId('homeAnterior').addEventListener('click', () => selecionarDestaque(estado.indice - 1, true));
        porId('homeProximo').addEventListener('click', () => selecionarDestaque(estado.indice + 1, true));
        secao.addEventListener('mouseenter', () => { estado.pausado = true; pararRotacao(); });
        secao.addEventListener('mouseleave', () => { estado.pausado = false; iniciarRotacao(); });
        secao.addEventListener('focusin', () => { estado.pausado = true; pararRotacao(); });
        secao.addEventListener('focusout', event => {
            if (secao.contains(event.relatedTarget)) return;
            estado.pausado = false;
            iniciarRotacao();
        });
        secao.addEventListener('pointerdown', event => { estado.toqueInicioX = event.clientX; });
        secao.addEventListener('pointerup', event => {
            if (estado.toqueInicioX === null) return;
            const deslocamento = event.clientX - estado.toqueInicioX;
            estado.toqueInicioX = null;
            if (Math.abs(deslocamento) < 45) return;
            selecionarDestaque(estado.indice + (deslocamento < 0 ? 1 : -1), true);
        });
    }

    function renderizarDestaques(destaques, intervaloMs) {
        estado.intervaloMs = Math.min(1800000, Math.max(200, Number(intervaloMs || 7000)));
        estado.destaques = Array.isArray(destaques) ? destaques.slice(0, 3) : [];
        if (!estado.destaques.length) return false;
        porId('homeDestaques').hidden = false;
        criarSeletor();
        renderizarDestaque();
        configurarInteracaoDestaques();
        iniciarRotacao();
        return true;
    }

    function moeda(valor) {
        return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function cardProduto(produto) {
        const link = document.createElement('a');
        link.className = 'home-produto-card';
        link.href = `/produto.html?id=${encodeURIComponent(produto.id)}`;
        const imagem = document.createElement('img');
        imagem.src = imagemCloudinary(produto.foto, 500);
        imagem.alt = produto.nome || 'Produto Core Case';
        imagem.loading = 'lazy'; imagem.decoding = 'async';
        const rotulosTags = { novo:'Novo', queima:'Queima de estoque', exclusivo:'Exclusivo', 'promocao-limitada':'Promoção limitada' };
        const tags = document.createElement('div'); tags.className = 'home-produto-tags';
        (Array.isArray(produto.produto_tags) ? produto.produto_tags : []).forEach(tag => {
            if (!rotulosTags[tag]) return;
            const selo = document.createElement('span'); selo.textContent = rotulosTags[tag]; tags.appendChild(selo);
        });
        const nome = document.createElement('h3'); nome.textContent = produto.nome || 'Produto';
        const preco = document.createElement('div'); preco.className = 'home-produto-preco';
        preco.innerHTML = produto.promocao_valida
            ? `<del>R$ ${moeda(produto.preco)}</del><strong>R$ ${moeda(produto.preco_efetivo)}</strong>`
            : `<strong>R$ ${moeda(produto.preco_efetivo)}</strong>`;
        link.append(imagem);
        if (tags.childElementCount) link.append(tags);
        link.append(nome, preco);
        return link;
    }

    function renderizarProdutosDestaque(secoes, produtos, categorias) {
        const alvo = porId('homeProdutosDestaque');
        const categoriasPorId = new Map((categorias || []).map(c => [Number(c.id), c]));
        const fragmento = document.createDocumentFragment();
        (secoes || []).forEach((secao, indice) => {
            const categoria = categoriasPorId.get(Number(secao.categoria_id));
            const lista = secao.origem === 'categoria' ? produtos.filter(p => Number(p.categoria_id) === Number(secao.categoria_id)) : produtos;
            const bloco = document.createElement('section'); bloco.className = 'home-produtos-secao';
            const titulo = document.createElement('h2'); titulo.textContent = secao.origem === 'categoria' ? (categoria?.nome || 'Categoria') : 'Melhores produtos';
            const wrap = document.createElement('div'); wrap.className = 'home-produtos-wrap';
            const trilho = document.createElement('div'); trilho.className = 'home-produtos-trilho'; trilho.id = `homeProdutosTrilho${indice}`;
            if (lista.length) trilho.append(...lista.map(cardProduto));
            else {
                const vazio = document.createElement('p'); vazio.className = 'home-produtos-vazio'; vazio.textContent = 'Nenhum produto disponível nesta seção.'; trilho.appendChild(vazio);
            }
            const anterior = document.createElement('button'); anterior.type = 'button'; anterior.className = 'home-produto-seta anterior'; anterior.textContent = '‹'; anterior.setAttribute('aria-label', 'Produtos anteriores');
            const proximo = document.createElement('button'); proximo.type = 'button'; proximo.className = 'home-produto-seta proximo'; proximo.textContent = '›'; proximo.setAttribute('aria-label', 'Próximos produtos');
            anterior.addEventListener('click', () => trilho.scrollBy({ left: -trilho.clientWidth, behavior: 'smooth' }));
            proximo.addEventListener('click', () => trilho.scrollBy({ left: trilho.clientWidth, behavior: 'smooth' }));
            if (lista.length <= 4) { anterior.hidden = true; proximo.hidden = true; }
            wrap.append(anterior, trilho, proximo); bloco.append(titulo, wrap); fragmento.appendChild(bloco);
        });
        alvo.replaceChildren(fragmento);
        alvo.hidden = !(secoes || []).length;
        return (secoes || []).length > 0;
    }

    function criarCardCategoria(item) {
        const link = document.createElement('a');
        link.className = 'home-categoria-card';
        link.href = `/loja.html?categoria=${encodeURIComponent(item.categoria_slug)}`;
        link.setAttribute('aria-label', `Ver produtos da categoria ${item.categoria_nome}`);

        const imagemWrap = document.createElement('div');
        imagemWrap.className = 'home-categoria-imagem';
        const imagem = document.createElement('img');
        imagem.src = imagemCloudinary(item.imagem, 800);
        imagem.alt = item.categoria_nome || 'Categoria Core Case';
        imagem.width = 800;
        imagem.height = 500;
        imagem.loading = 'lazy';
        imagem.decoding = 'async';
        imagemWrap.appendChild(imagem);

        const conteudo = document.createElement('div');
        conteudo.className = 'home-categoria-conteudo';
        const titulo = document.createElement('h2');
        titulo.textContent = item.categoria_nome || 'Categoria';
        const legenda = document.createElement('p');
        legenda.textContent = item.legenda || 'Conheca os produtos selecionados.';
        const cta = document.createElement('span');
        cta.textContent = 'Ver mais →';
        conteudo.append(titulo, legenda, cta);
        link.append(imagemWrap, conteudo);
        return link;
    }

    function renderizarCategorias(categorias) {
        const lista = Array.isArray(categorias) ? categorias : [];
        if (!lista.length) return false;
        const grid = porId('homeCategoriasGrid');
        grid.replaceChildren(...lista.map(criarCardCategoria));
        porId('homeCategorias').hidden = false;
        return true;
    }

    function renderizarRodape(rodape) {
        const email = String(rodape?.email || 'corecasesolucoes@gmail.com').trim();
        const descricao = String(rodape?.descricao || 'Tecnologia, acessorios e produtos selecionados para sua rotina.').trim();
        porId('homeFooterDescricao').textContent = descricao;
        porId('homeFooterEmail').textContent = email;
        porId('homeFooterEmail').href = `mailto:${email}`;
        porId('homeAno').textContent = String(new Date().getFullYear());
    }

    function mostrarFallback() {
        porId('homeFallback').hidden = false;
    }

    async function inicializarHome() {
        renderizarRodape(null);
        try {
            const [resposta, respostaLoja] = await Promise.all([fetch('/api/vitrine'), fetch('/api/loja/bootstrap')]);
            if (!resposta.ok || !respostaLoja.ok) throw new Error('Falha ao carregar vitrine.');
            const [dados, loja] = await Promise.all([resposta.json(), respostaLoja.json()]);
            const temDestaques = renderizarDestaques(dados.destaques, dados.intervalo_ms);
            const temCategorias = renderizarCategorias(dados.categorias);
            const temProdutos = renderizarProdutosDestaque(dados.produtos_destaque, loja.produtos || [], loja.categorias || []);
            renderizarRodape(dados.rodape);
            if (!temDestaques && !temCategorias && !temProdutos) mostrarFallback();
        } catch (erro) {
            console.warn('[home] Nao foi possivel carregar a vitrine.');
            mostrarFallback();
        } finally {
            porId('homeCarregando').hidden = true;
        }
    }

    inicializarHome();
})();
