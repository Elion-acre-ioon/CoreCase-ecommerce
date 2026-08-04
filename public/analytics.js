/* ============================================================================
 * analytics.js — Rastreamento GA4 (Google Analytics 4) + Meta Pixel
 * ----------------------------------------------------------------------------
 * Configure os dois IDs abaixo (linhas GA4_MEASUREMENT_ID e META_PIXEL_ID) e
 * pronto — nenhum outro arquivo do site precisa ser mexido para isso.
 * Se algum ID ficar com o valor de exemplo, aquele rastreador simplesmente
 * não carrega (não gera erro no site).
 * ============================================================================ */

const GA4_MEASUREMENT_ID = 'G-F4H7LZ38SV';   // <-- troque pelo seu ID do GA4 (Admin > Fluxos de dados)
const META_PIXEL_ID = '0000000000000000';    // <-- troque pelo ID do seu Pixel (Gerenciador de Eventos)

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------
(function (id) {
    if (!id || id.indexOf('XXXXXXXXXX') !== -1) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', id);
})(GA4_MEASUREMENT_ID);

// ---------------------------------------------------------------------------
// Meta Pixel (código oficial da Meta)
// ---------------------------------------------------------------------------
(function (id) {
    if (!id || id.indexOf('0000000000000000') !== -1) return;

    !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0';
        n.queue = []; t = b.createElement(e); t.async = true;
        t.src = v; s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', id);
    fbq('track', 'PageView');
})(META_PIXEL_ID);

/* ============================================================================
 * Funções auxiliares de eventos de e-commerce.
 * Chamadas automaticamente nos pontos-chave do site (produto.html, usuario.js
 * e checkout.html) — não é necessário chamar manualmente em nada.
 * ============================================================================ */

function rastrearVisualizacaoProduto(produto) {
    if (!produto) return;
    if (window.gtag) {
        gtag('event', 'view_item', {
            currency: 'BRL',
            value: Number(produto.preco || 0),
            items: [{ item_id: String(produto.id), item_name: produto.nome, price: Number(produto.preco || 0) }]
        });
    }
    if (window.fbq) {
        fbq('track', 'ViewContent', {
            content_ids: [String(produto.id)],
            content_name: produto.nome,
            content_type: 'product',
            currency: 'BRL',
            value: Number(produto.preco || 0)
        });
    }
}

function rastrearAdicionarCarrinho(item) {
    if (!item) return;
    const valor = Number(item.preco || 0) * Number(item.qtd || 1);
    if (window.gtag) {
        gtag('event', 'add_to_cart', {
            currency: 'BRL',
            value: valor,
            items: [{ item_id: String(item.id), item_name: item.nome, price: Number(item.preco || 0), quantity: Number(item.qtd || 1) }]
        });
    }
    if (window.fbq) {
        fbq('track', 'AddToCart', {
            content_ids: [String(item.id)],
            content_name: item.nome,
            content_type: 'product',
            currency: 'BRL',
            value: valor
        });
    }
}

function rastrearInicioCheckout(itens, total) {
    const lista = Array.isArray(itens) ? itens : [];
    if (window.gtag) {
        gtag('event', 'begin_checkout', {
            currency: 'BRL',
            value: Number(total || 0),
            items: lista.map(i => ({ item_id: String(i.id), item_name: i.nome, price: Number(i.preco || 0), quantity: Number(i.qtd || 1) }))
        });
    }
    if (window.fbq) {
        fbq('track', 'InitiateCheckout', {
            content_ids: lista.map(i => String(i.id)),
            currency: 'BRL',
            value: Number(total || 0),
            num_items: lista.length
        });
    }
}

function rastrearCompraFinalizada(codigoPedido, total, itens) {
    const lista = Array.isArray(itens) ? itens : [];
    if (window.gtag) {
        gtag('event', 'purchase', {
            transaction_id: String(codigoPedido || ''),
            currency: 'BRL',
            value: Number(total || 0),
            items: lista.map(i => ({ item_id: String(i.id), item_name: i.nome, price: Number(i.preco || 0), quantity: Number(i.qtd || 1) }))
        });
    }
    if (window.fbq) {
        fbq('track', 'Purchase', {
            content_ids: lista.map(i => String(i.id)),
            currency: 'BRL',
            value: Number(total || 0),
            num_items: lista.length
        });
    }
}