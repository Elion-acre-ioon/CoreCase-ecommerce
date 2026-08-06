/* ============================================================================
 * MÓDULO: imageStorage.js
 * ----------------------------------------------------------------------------
 * Responsável por salvar as imagens enviadas em base64 (fotos de produto e
 * foto de perfil do usuário).
 *
 * CORREÇÃO (ver seção 11 da documentação — "mover upload para serviço
 * externo"): antes as imagens eram sempre salvas em disco, na pasta
 * /uploads. Isso funciona rodando localmente, mas em ambientes serverless
 * (Netlify Functions, Vercel etc.) o sistema de arquivos é efêmero — as
 * imagens somem a cada novo deploy ou "cold start".
 *
 * Como funciona agora:
 *   - Se as variáveis de ambiente do Cloudinary estiverem configuradas
 *     (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET),
 *     as imagens são enviadas para lá e a URL pública e definitiva do
 *     Cloudinary é o que fica salvo no banco.
 *   - Se essas variáveis NÃO estiverem configuradas, o sistema cai no
 *     comportamento antigo (salvar em disco, pasta /uploads) — ótimo para
 *     rodar localmente, mas não recomendado para produção serverless.
 *
 * Para ativar o Cloudinary: crie uma conta gratuita em cloudinary.com,
 * copie as 3 credenciais do painel e coloque no seu .env (veja .env.example).
 * ============================================================================ */

const fs = require('fs');
const path = require('path');

const pastaUploads = path.join(__dirname, 'uploads');

// Em ambiente serverless (Netlify Functions) o filesystem do projeto é
// somente-leitura — só é possível escrever em /tmp. Como o Cloudinary já
// cobre o caso de produção, só criamos a pasta local quando realmente for
// necessário (ambiente local, sem Cloudinary configurado), e protegido por
// try/catch para nunca derrubar a inicialização do servidor.
try {
    if (!fs.existsSync(pastaUploads)) {
        fs.mkdirSync(pastaUploads, { recursive: true });
    }
} catch (erroCriarPasta) {
    console.warn('[imageStorage] Não foi possível criar pasta /uploads (normal em ambiente serverless):', erroCriarPasta.message);
}

const cloudinaryConfigurado = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

let cloudinary = null;

if (cloudinaryConfigurado) {
    cloudinary = require('cloudinary').v2;

    // DEBUG TEMPORÁRIO: confirma no log qual API_KEY está realmente sendo lida
    // da variável de ambiente, sem expor o secret. Remover depois de resolver.

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
        api_key: process.env.CLOUDINARY_API_KEY.trim(),
        api_secret: process.env.CLOUDINARY_API_SECRET.trim()
    });
    console.log('[imageStorage] Cloudinary configurado — imagens serão salvas na nuvem.');
} else {
    console.warn(
        '[imageStorage] Cloudinary NÃO configurado — salvando imagens em disco local (/uploads). ' +
        'Isso é aceitável em ambiente local, mas NÃO é persistente em Netlify Functions / serverless. ' +
        'Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET para produção.'
    );
}

/**
 * Salva uma única imagem em base64 (ex: "data:image/jpeg;base64,....").
 * Retorna a URL pública para ser guardada no banco, ou null se a entrada for inválida/vazia.
 */
async function salvarImagemBase64(base64, prefixo = 'img') {
    if (!base64 || typeof base64 !== 'string' || !base64.includes(',')) {
        return null;
    }

    // --- Caminho 1: Cloudinary configurado (produção recomendada) ---
    if (cloudinaryConfigurado) {
        const resultado = await cloudinary.uploader.upload(base64, {
            public_id: `core-case_${prefixo}-${Date.now()}`
        });
        return resultado.secure_url;
    }

    // --- Caminho 2: fallback local em disco (dev / sem Cloudinary) ---
    const nomeArquivo = `${prefixo}-${Date.now()}-${Math.round(Math.random() * 1000)}.jpg`;
    const buffer = Buffer.from(base64.split(',')[1], 'base64');
    fs.writeFileSync(path.join(pastaUploads, nomeArquivo), buffer);
    return `/uploads/${nomeArquivo}`;
}

/**
 * Salva uma lista de imagens em base64 (usado no cadastro/edição de produtos,
 * que aceita múltiplas fotos). Retorna um array com as URLs finais.
 */
async function salvarVariasImagensBase64(lista, prefixo = 'prod') {
    const urls = [];
    if (!Array.isArray(lista)) return urls;

    for (let indice = 0; indice < lista.length; indice++) {
        const url = await salvarImagemBase64(lista[indice], `${prefixo}-${indice}`);
        if (url) urls.push(url);
    }
    return urls;
}

// Aceita imagens e vídeos para avaliações. No Cloudinary, resource_type:auto
// preserva o tipo; localmente mantém a extensão informada no data URL.
async function salvarMidiaBase64(base64, prefixo = 'midia') {
    if (!base64 || typeof base64 !== 'string' || !base64.includes(',')) return null;
    if (cloudinaryConfigurado) {
        const resultado = await cloudinary.uploader.upload(base64, {
            public_id: `core-case_${prefixo}-${Date.now()}`,
            resource_type: 'auto'
        });
        return resultado.secure_url;
    }
    const mime = (base64.match(/^data:([^;]+);base64,/) || [])[1] || 'application/octet-stream';
    const extensao = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[mime] || 'bin';
    const nomeArquivo = `${prefixo}-${Date.now()}-${Math.round(Math.random() * 1000)}.${extensao}`;
    fs.writeFileSync(path.join(pastaUploads, nomeArquivo), Buffer.from(base64.split(',')[1], 'base64'));
    return `/uploads/${nomeArquivo}`;
}

module.exports = {
    salvarImagemBase64,
    salvarVariasImagensBase64,
    salvarMidiaBase64,
    cloudinaryConfigurado,
    pastaUploads
};
