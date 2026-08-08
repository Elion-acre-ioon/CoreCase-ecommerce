/* ============================================================================
 * ARQUIVO: api.js
 * Lógica central de negócios e rotas da API.
 * Exporta a função handleRequest(req, res) para uso em server.js e Netlify.
 * ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2');
const { OAuth2Client } = require('google-auth-library');

const mpService = require('./mercadopagoService');
const imageStorage = require('./imageStorage');
const emailService = require('./emailService');

/* ============================================================================
 * CONEXÃO COM BANCO DE DADOS (MySQL)
 * ============================================================================ */
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'corecase',
    port: process.env.MYSQL_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
const db = pool.promise();

/* ============================================================================
 * CONFIGURAÇÕES GERAIS E CREDENCIAIS
 * ============================================================================ */
const pastaPublic = path.join(__dirname, 'public');
try {
    if (!fs.existsSync(pastaPublic)) {
        fs.mkdirSync(pastaPublic, { recursive: true });
    }
} catch (erroCriarPastaPublic) {
    console.warn('[api.js] Aviso: Não foi possível criar pasta /public (normal em ambiente serverless):', erroCriarPastaPublic.message);
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_COOKIE = 'cc_session';
const ADMIN_SESSION_COOKIE = 'cc_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL_MINUTES = Number(process.env.RESET_PASSWORD_TTL_MINUTES || 45);
const RATE_LIMITS = new Map();
const SCHEMA_VERSION = 2;
const SCHEMA_MIGRATION_LOCK = 'core_case_schema_migrations';
let promessaBancoPronto = null;
let diagnosticoBanco = null;
let googleOAuthClient = null;

function validarConfiguracaoSegura() {
    const emProducao = process.env.NODE_ENV === 'production' || Boolean(process.env.NETLIFY);
    const faltando = [];
    if (!process.env.ADMIN_TOKEN) faltando.push('ADMIN_TOKEN');
    if (!process.env.ADMIN_USER) faltando.push('ADMIN_USER');
    if (!process.env.ADMIN_SENHA) faltando.push('ADMIN_SENHA');
    if (!process.env.SESSION_SECRET) faltando.push('SESSION_SECRET');
    if (faltando.length) {
        console.error('[config] Variaveis obrigatorias ausentes:', faltando.join(', '));
        if (emProducao) console.error('[config] Ambiente de producao deve configurar segredos somente nas variaveis da hospedagem.');
    } else {
        console.log('[config] segredos obrigatorios configurados=true');
    }
}

validarConfiguracaoSegura();

function agoraMs() {
    return Number(process.hrtime.bigint() / 1000000n);
}

function logPerf(mensagem, extras = {}) {
    const detalhe = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[perf] ${mensagem}${detalhe ? ' ' + detalhe : ''}`);
}

function setServerTiming(res, metricas) {
    if (!res || typeof res.setHeader !== 'function' || !Array.isArray(metricas)) return;
    const valor = metricas
        .filter(m => m && m.name && Number.isFinite(Number(m.dur)))
        .map(m => `${m.name};dur=${Math.max(0, Math.round(Number(m.dur)))}`)
        .join(', ');
    if (valor) res.setHeader('Server-Timing', valor);
}

function erroSeguro(erro) {
    return {
        code: erro?.code,
        errno: erro?.errno,
        sqlState: erro?.sqlState,
        message: erro?.message
    };
}

function logErroSeguro(prefixo, erro, extras = {}) {
    console.error(prefixo, { ...extras, ...erroSeguro(erro) });
}

function erroInfraestrutura(message, cause) {
    const erro = new Error(message);
    erro.infraestrutura = true;
    erro.cause = cause;
    return erro;
}

function hashToken(valor) {
    return crypto.createHash('sha256').update(String(valor || '')).digest('hex');
}

function parseCookies(req) {
    return Object.fromEntries(String(req.headers.cookie || '')
        .split(';')
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => {
            const idx = p.indexOf('=');
            return idx === -1 ? [p, ''] : [p.slice(0, idx), decodeURIComponent(p.slice(idx + 1))];
        }));
}

function cookieSeguro(req) {
    const proto = req.headers['x-forwarded-proto'];
    return proto === 'https' || process.env.NODE_ENV === 'production' || Boolean(process.env.NETLIFY);
}

function cookieHttpOnly(req, nome, token, maxAgeSeconds) {
    const partes = [
        `${nome}=${encodeURIComponent(token || '')}`,
        'HttpOnly',
        'Path=/',
        'SameSite=Lax',
        `Max-Age=${maxAgeSeconds}`
    ];
    if (cookieSeguro(req)) partes.push('Secure');
    return partes.join('; ');
}

function cookieSessao(req, token, maxAgeSeconds) {
    return cookieHttpOnly(req, SESSION_COOKIE, token, maxAgeSeconds);
}

function cookieSessaoAdmin(req, token, maxAgeSeconds) {
    return cookieHttpOnly(req, ADMIN_SESSION_COOKIE, token, maxAgeSeconds);
}

function anexarCookie(res, cookie) {
    const atual = res.getHeader ? res.getHeader('Set-Cookie') : null;
    if (atual) {
        res.setHeader('Set-Cookie', Array.isArray(atual) ? [...atual, cookie] : [atual, cookie]);
    } else {
        res.setHeader('Set-Cookie', cookie);
    }
}

function clienteIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
}

function limiteRequisicoes(chave, limite, janelaMs) {
    const agora = Date.now();
    const atual = RATE_LIMITS.get(chave) || { inicio: agora, total: 0 };
    if (agora - atual.inicio > janelaMs) {
        RATE_LIMITS.set(chave, { inicio: agora, total: 1 });
        return true;
    }
    atual.total += 1;
    RATE_LIMITS.set(chave, atual);
    return atual.total <= limite;
}

// Token legado de sessão do cliente: mantido apenas como compatibilidade temporária.
function gerarTokenCliente(idUsuario) {
    if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN nao configurado.');
    return crypto.createHmac('sha256', ADMIN_TOKEN).update(String(idUsuario)).digest('hex');
}

function tokenClienteValido(req, idEsperado) {
    if (!ADMIN_TOKEN) return false;
    const tokenRecebido = req.headers['x-user-token'];
    if (!tokenRecebido || !idEsperado) return false;
    const esperado = gerarTokenCliente(idEsperado);
    const bufA = Buffer.from(String(tokenRecebido));
    const bufB = Buffer.from(esperado);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_SENHA = process.env.ADMIN_SENHA;

/* ============================================================================
 * INICIALIZAÇÃO E MIGRAÇÕES DO BANCO
 * ============================================================================ */
function nomeBancoAtual() {
    return process.env.MYSQL_DATABASE || 'corecase';
}

async function executarMigracao(nome, fn) {
    console.log(`[db:migration] iniciando ${nome}`);
    try {
        await fn();
        console.log(`[db:migration] ${nome}: OK`);
        return true;
    } catch (erro) {
        logErroSeguro(`[db:migration] ${nome}: FALHOU`, erro);
        return false;
    }
}

async function colunaExiste(tabela, coluna) {
    const [rows] = await db.execute(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [nomeBancoAtual(), tabela, coluna]
    );
    return rows.length > 0;
}

async function tabelaExiste(tabela) {
    const [rows] = await db.execute(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
        [nomeBancoAtual(), tabela]
    );
    return rows.length > 0;
}

async function definicaoColuna(tabela, coluna) {
    const [rows] = await db.execute(
        `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [nomeBancoAtual(), tabela, coluna]
    );
    return rows[0] || null;
}

function tipoFkCompatível(colunaPai, fallback = 'INT') {
    if (!colunaPai?.COLUMN_TYPE) return fallback;
    const tipo = String(colunaPai.COLUMN_TYPE).toUpperCase();
    if (tipo.includes('BIGINT')) return tipo.includes('UNSIGNED') ? 'BIGINT UNSIGNED' : 'BIGINT';
    if (tipo.includes('INT')) return tipo.includes('UNSIGNED') ? 'INT UNSIGNED' : 'INT';
    return fallback;
}

async function adicionarColunaSeNaoExiste(tabela, coluna, definicao) {
    if (await colunaExiste(tabela, coluna)) return false;
    try {
        await db.execute(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
        return true;
    } catch (erro) {
        if (erro.code === 'ER_DUP_FIELDNAME') return false;
        throw erro;
    }
}

async function adicionarColunas(tabela, colunas) {
    for (const [coluna, definicao] of colunas) {
        await adicionarColunaSeNaoExiste(tabela, coluna, definicao);
    }
}

function tabelaAusente(diagnostico, tabela) {
    return diagnostico?.tabelas?.[tabela] === false;
}

function colunaAusente(diagnostico, chave) {
    return diagnostico?.colunas?.[chave] === false;
}

async function verificarEstruturaBanco() {
    const tabelasObrigatorias = [
        'usuarios', 'sessoes', 'recuperacoes_senha', 'identidades_usuario',
        'pedidos', 'pedido_itens', 'pedido_enderecos', 'configuracoes', 'categorias'
    ];
    const tabelas = {};
    for (const tabela of tabelasObrigatorias) {
        tabelas[tabela] = await tabelaExiste(tabela);
        console.log(`[db:migration] ${tabela}: ${tabelas[tabela] ? 'OK' : 'FALHOU'}`);
    }

    const colunas = {
        usuarios_sessao_versao: await colunaExiste('usuarios', 'sessao_versao'),
        pedidos_criado_em: await colunaExiste('pedidos', 'criado_em'),
        pedidos_valor_frete: await colunaExiste('pedidos', 'valor_frete'),
        pedidos_utm_source: await colunaExiste('pedidos', 'utm_source'),
        produtos_categoria_id: await colunaExiste('produtos', 'categoria_id')
    };
    for (const [nome, existe] of Object.entries(colunas)) {
        console.log(`[db:migration] ${nome}: ${existe ? 'OK' : 'FALHOU'}`);
    }

    diagnosticoBanco = { conectado: true, tabelas, colunas };
    return diagnosticoBanco;
}

async function garantirTabelaSchemaMigrations() {
    await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
        versao INT PRIMARY KEY,
        nome VARCHAR(150),
        executada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function schemaVersionAtual() {
    const [rows] = await db.execute('SELECT MAX(versao) AS versao FROM schema_migrations');
    return Number(rows[0]?.versao || 0);
}

async function registrarSchemaVersion(versao, nome) {
    await db.execute(
        `INSERT INTO schema_migrations (versao, nome)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE nome = VALUES(nome)`,
        [versao, nome]
    );
}

async function comLockMigracao(fn) {
    let lockObtido = false;
    try {
        const [rows] = await db.execute('SELECT GET_LOCK(?, 15) AS obtido', [SCHEMA_MIGRATION_LOCK]);
        lockObtido = Number(rows[0]?.obtido) === 1;
        if (!lockObtido) throw new Error('Nao foi possivel obter lock de migration.');
        return await fn();
    } finally {
        if (lockObtido) {
            try { await db.execute('SELECT RELEASE_LOCK(?)', [SCHEMA_MIGRATION_LOCK]); } catch (e) {}
        }
    }
}

function normalizarItemPedidoHistorico(item) {
    if (!item || typeof item !== 'object') return null;
    const quantidade = Math.max(1, Number(item.qtd || item.quantidade || 1));
    const preco = Math.max(0, Number(item.preco || item.preco_unitario || 0));
    const frete = Math.max(0, Number(item.frete || item.frete_unitario || 0));
    return {
        produto_id: Number(item.id || item.produto_id) || null,
        nome_produto: String(item.nome || item.nome_produto || 'Produto').slice(0, 255),
        variante: normalizarNomeVariantePedido(item.variante),
        quantidade,
        preco_unitario: preco,
        frete_unitario: frete,
        total_item: (preco + frete) * quantidade
    };
}

async function backfillPedidoItens() {
    if (!(await tabelaExiste('pedido_itens')) || !(await tabelaExiste('pedidos'))) return;
    const [pedidos] = await db.execute(
        `SELECT p.id, p.produtos_json
         FROM pedidos p
         LEFT JOIN pedido_itens pi ON pi.pedido_id = p.id
         WHERE pi.id IS NULL AND p.produtos_json IS NOT NULL
         LIMIT 250`
    );
    let pedidosProcessados = 0;
    let itensCriados = 0;
    for (const pedido of pedidos) {
        let itens = [];
        try { itens = JSON.parse(pedido.produtos_json || '[]'); } catch (e) { itens = []; }
        if (!Array.isArray(itens) || !itens.length) continue;
        const normalizados = itens.map(normalizarItemPedidoHistorico).filter(Boolean);
        if (!normalizados.length) continue;
        for (const item of normalizados) {
            await db.execute(
                `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, variante, quantidade, preco_unitario, frete_unitario, total_item)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [pedido.id, item.produto_id, item.nome_produto, item.variante, item.quantidade, item.preco_unitario, item.frete_unitario, item.total_item]
            );
            itensCriados++;
        }
        pedidosProcessados++;
    }
    console.log(`[analytics] backfill pedido_itens pedidos_processados=${pedidosProcessados} itens_criados=${itensCriados}`);
}

async function inicializarBanco() {
    const inicioTotal = agoraMs();
    await garantirTabelaSchemaMigrations();
    const inicioCheck = agoraMs();
    const versaoInicial = await schemaVersionAtual();
    logPerf('schema_check', { ms: agoraMs() - inicioCheck, version: versaoInicial });

    if (versaoInicial >= SCHEMA_VERSION) {
        diagnosticoBanco = diagnosticoBanco || { conectado: true, tabelas: {}, colunas: {}, schema_version: versaoInicial };
        logPerf('migrations_skipped', { version: versaoInicial, db_ready_ms: agoraMs() - inicioTotal });
        return diagnosticoBanco;
    }

    return await comLockMigracao(async () => {
        const versaoComLock = await schemaVersionAtual();
        if (versaoComLock >= SCHEMA_VERSION) {
            diagnosticoBanco = diagnosticoBanco || { conectado: true, tabelas: {}, colunas: {}, schema_version: versaoComLock };
            logPerf('migrations_skipped', { version: versaoComLock, db_ready_ms: agoraMs() - inicioTotal });
            return diagnosticoBanco;
        }

    const migracoes = [];
    migracoes.push(['usuarios', async () => {
        await db.execute(`CREATE TABLE IF NOT EXISTS usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255),
            cpf VARCHAR(20) UNIQUE,
            cep VARCHAR(20),
            endereco TEXT,
            telefone VARCHAR(20),
            email VARCHAR(255) UNIQUE,
            senha VARCHAR(255),
            foto VARCHAR(255),
            is_admin INT DEFAULT 0,
            sessao_versao INT DEFAULT 0
        )`);
        await adicionarColunaSeNaoExiste('usuarios', 'sessao_versao', 'INT DEFAULT 0');
    }]);

    migracoes.push(['produtos.columns', async () => {
        await db.execute(`CREATE TABLE IF NOT EXISTS produtos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255),
            preco DECIMAL(10,2),
            descricao TEXT,
            sobre TEXT,
            informacoes TEXT,
            foto TEXT,
            max_parcelas INT DEFAULT 12,
            juros_mensal DECIMAL(5,2) DEFAULT 0.0,
            variantes TEXT,
            preco_promocional DECIMAL(10,2) NULL,
            promocao_ativa TINYINT(1) DEFAULT 0,
            frete DECIMAL(10,2) DEFAULT 0,
            frete_promocional DECIMAL(10,2) NULL,
            frete_promocao_ativa TINYINT(1) DEFAULT 0,
            estoque INT DEFAULT 0,
            vendas_iniciais INT DEFAULT 0,
            vendas_confirmadas INT DEFAULT 0,
            produto_tags TEXT,
            categoria_id INT NULL
        )`);
        await adicionarColunas('produtos', [
            ['variantes', 'TEXT'],
            ['preco_promocional', 'DECIMAL(10,2) NULL'],
            ['promocao_ativa', 'TINYINT(1) DEFAULT 0'],
            ['frete', 'DECIMAL(10,2) DEFAULT 0'],
            ['frete_promocional', 'DECIMAL(10,2) NULL'],
            ['frete_promocao_ativa', 'TINYINT(1) DEFAULT 0'],
            ['estoque', 'INT DEFAULT 0'],
            ['vendas_iniciais', 'INT DEFAULT 0'],
            ['vendas_confirmadas', 'INT DEFAULT 0'],
            ['produto_tags', 'TEXT'],
            ['categoria_id', 'INT NULL']
        ]);
        try { await db.execute('CREATE INDEX idx_produtos_categoria_id ON produtos (categoria_id)'); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
        console.log('[db:migration] produtos.categoria_id: OK');
    }]);

    migracoes.push(['categorias', async () => {
        const categoriaIdTipo = tipoFkCompatível(await definicaoColuna('categorias', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS categorias (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(120) NOT NULL,
            slug VARCHAR(150) NOT NULL UNIQUE,
            descricao TEXT NULL,
            imagem_url TEXT NULL,
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            ordem INT NOT NULL DEFAULT 0,
            parent_id ${categoriaIdTipo} NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME NULL,
            INDEX idx_categorias_ativo (ativo),
            INDEX idx_categorias_ordem (ordem),
            INDEX idx_categorias_parent_id (parent_id)
        )`);
        try { await db.execute('CREATE INDEX idx_categorias_slug ON categorias (slug)'); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
        console.log('[db:migration] categorias: OK');
    }]);

    migracoes.push(['comentarios', async () => {
        await db.execute(`CREATE TABLE IF NOT EXISTS comentarios_produto (
            id INT AUTO_INCREMENT PRIMARY KEY, produto_id INT NOT NULL, usuario_id INT NULL,
            nome_manual VARCHAR(255) NULL, foto_manual TEXT NULL, nota DECIMAL(3,1) NOT NULL,
            texto TEXT NOT NULL, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.execute(`CREATE TABLE IF NOT EXISTS comentario_midias (
            id INT AUTO_INCREMENT PRIMARY KEY, comentario_id INT NOT NULL, tipo VARCHAR(10) NOT NULL, arquivo TEXT NOT NULL
        )`);
    }]);

    migracoes.push(['pedidos.analytics_columns', async () => {
        await db.execute(`CREATE TABLE IF NOT EXISTS pedidos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codigo_pedido INT,
            cliente_id INT,
            nome_recebedor VARCHAR(255),
            endereco_envio TEXT,
            produtos_json TEXT,
            total DECIMAL(10,2),
            forma_pagamento VARCHAR(50),
            status VARCHAR(100),
            mercadopago_id VARCHAR(255),
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            pago_em DATETIME NULL,
            enviado_em DATETIME NULL,
            entregue_em DATETIME NULL,
            cancelado_em DATETIME NULL,
            subtotal DECIMAL(10,2) DEFAULT 0,
            valor_frete DECIMAL(10,2) DEFAULT 0,
            desconto DECIMAL(10,2) DEFAULT 0,
            taxa_pagamento DECIMAL(10,2) DEFAULT 0,
            origem VARCHAR(100) NULL,
            utm_source VARCHAR(150) NULL,
            utm_medium VARCHAR(150) NULL,
            utm_campaign VARCHAR(150) NULL,
            utm_content VARCHAR(150) NULL,
            utm_term VARCHAR(150) NULL,
            gclid VARCHAR(255) NULL,
            fbclid VARCHAR(255) NULL
        )`);
        await adicionarColunas('pedidos', [
            ['criado_em', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
            ['pago_em', 'DATETIME NULL'],
            ['enviado_em', 'DATETIME NULL'],
            ['entregue_em', 'DATETIME NULL'],
            ['cancelado_em', 'DATETIME NULL'],
            ['subtotal', 'DECIMAL(10,2) DEFAULT 0'],
            ['valor_frete', 'DECIMAL(10,2) DEFAULT 0'],
            ['desconto', 'DECIMAL(10,2) DEFAULT 0'],
            ['taxa_pagamento', 'DECIMAL(10,2) DEFAULT 0'],
            ['origem', 'VARCHAR(100) NULL'],
            ['utm_source', 'VARCHAR(150) NULL'],
            ['utm_medium', 'VARCHAR(150) NULL'],
            ['utm_campaign', 'VARCHAR(150) NULL'],
            ['utm_content', 'VARCHAR(150) NULL'],
            ['utm_term', 'VARCHAR(150) NULL'],
            ['gclid', 'VARCHAR(255) NULL'],
            ['fbclid', 'VARCHAR(255) NULL']
        ]);
        try { await db.execute('CREATE INDEX idx_pedidos_criado_em ON pedidos (criado_em)'); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
        try { await db.execute('CREATE INDEX idx_pedidos_status ON pedidos (status)'); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
    }]);

    migracoes.push(['sessoes', async () => {
        const usuarioIdTipo = tipoFkCompatível(await definicaoColuna('usuarios', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS sessoes (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            usuario_id ${usuarioIdTipo} NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            sessao_versao INT DEFAULT 0,
            expira_em DATETIME NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultimo_uso_em DATETIME NULL,
            revogado_em DATETIME NULL,
            user_agent VARCHAR(500) NULL,
            INDEX idx_usuario_id (usuario_id),
            INDEX idx_expira_em (expira_em),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )`);
    }]);

    migracoes.push(['recuperacoes_senha', async () => {
        const usuarioIdTipo = tipoFkCompatível(await definicaoColuna('usuarios', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS recuperacoes_senha (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id ${usuarioIdTipo} NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expira_em DATETIME NOT NULL,
            utilizado_em DATETIME NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_token_hash (token_hash),
            INDEX idx_usuario_id (usuario_id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )`);
    }]);

    migracoes.push(['identidades_usuario', async () => {
        const usuarioIdTipo = tipoFkCompatível(await definicaoColuna('usuarios', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS identidades_usuario (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            usuario_id ${usuarioIdTipo} NOT NULL,
            provedor VARCHAR(30) NOT NULL,
            provedor_usuario_id VARCHAR(255) NOT NULL,
            email_provedor VARCHAR(255) NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME NULL,
            UNIQUE KEY uk_provedor_usuario (provedor, provedor_usuario_id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )`);
    }]);

    migracoes.push(['pedido_itens', async () => {
        const pedidoIdTipo = tipoFkCompatível(await definicaoColuna('pedidos', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS pedido_itens (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            pedido_id ${pedidoIdTipo} NOT NULL,
            produto_id INT NULL,
            nome_produto VARCHAR(255) NOT NULL,
            variante VARCHAR(255) NULL,
            quantidade INT NOT NULL,
            preco_unitario DECIMAL(10,2) NOT NULL,
            custo_unitario DECIMAL(10,2) NULL,
            desconto_unitario DECIMAL(10,2) DEFAULT 0,
            frete_unitario DECIMAL(10,2) DEFAULT 0,
            total_item DECIMAL(10,2) NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pedido_id (pedido_id),
            INDEX idx_produto_id (produto_id),
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
        )`);
    }]);

    migracoes.push(['pedido_enderecos', async () => {
        const pedidoIdTipo = tipoFkCompatível(await definicaoColuna('pedidos', 'id'), 'INT');
        await db.execute(`CREATE TABLE IF NOT EXISTS pedido_enderecos (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            pedido_id ${pedidoIdTipo} NOT NULL,
            nome_destinatario VARCHAR(255) NOT NULL,
            cpf VARCHAR(14) NOT NULL,
            telefone VARCHAR(30) NULL,
            cep VARCHAR(9) NOT NULL,
            logradouro VARCHAR(255) NOT NULL,
            numero VARCHAR(30) NOT NULL,
            complemento VARCHAR(255) NULL,
            bairro VARCHAR(150) NOT NULL,
            cidade VARCHAR(150) NOT NULL,
            estado CHAR(2) NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_pedido_endereco (pedido_id),
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
        )`);
    }]);

    migracoes.push(['configuracoes', async () => {
        await db.execute(`CREATE TABLE IF NOT EXISTS configuracoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            public_key TEXT,
            access_token TEXT,
            chave_pix VARCHAR(255),
            nome_recebedor VARCHAR(255),
            ambiente VARCHAR(50) DEFAULT 'sandbox',
            banco VARCHAR(100),
            agencia VARCHAR(50),
            conta VARCHAR(50),
            taxa_entrega DECIMAL(10,2) DEFAULT 0.0,
            frete_gratis_acima DECIMAL(10,2) DEFAULT 0.0
        )`);
        const [rows] = await db.execute('SELECT id FROM configuracoes LIMIT 1');
        if (rows.length === 0) {
            await db.execute(
                `INSERT INTO configuracoes (public_key, access_token, chave_pix, nome_recebedor, ambiente) VALUES ('', '', '', '', 'sandbox')`
            );
        }
    }]);

    let migracoesExecutadas = 0;
    for (const [nome, fn] of migracoes) {
        await executarMigracao(nome, fn);
        migracoesExecutadas++;
    }
    await executarMigracao('analytics.backfill_pedido_itens', backfillPedidoItens);
    migracoesExecutadas++;
    const diagnostico = await verificarEstruturaBanco();
    await registrarSchemaVersion(SCHEMA_VERSION, 'schema consolidado core case');
    diagnostico.schema_version = SCHEMA_VERSION;
    const tabelasCriticas = ['usuarios', 'sessoes', 'recuperacoes_senha', 'identidades_usuario', 'pedidos', 'pedido_itens', 'pedido_enderecos', 'configuracoes', 'categorias'];
    const faltando = tabelasCriticas.filter(t => !diagnostico.tabelas[t]);
    if (faltando.length || !diagnostico.colunas.usuarios_sessao_versao || !diagnostico.colunas.pedidos_criado_em) {
        console.error('[db:migration] estrutura incompleta apos migrations', {
            tabelas_faltando: faltando,
            usuarios_sessao_versao: diagnostico.colunas.usuarios_sessao_versao,
            pedidos_criado_em: diagnostico.colunas.pedidos_criado_em
        });
    }
    logPerf('migrations_run', { count: migracoesExecutadas, version: SCHEMA_VERSION });
    console.log('[db:migration] banco pronto');
    logPerf('db_ready', { ms: agoraMs() - inicioTotal });
    return diagnostico;
    });
}

function garantirBancoPronto() {
    if (!promessaBancoPronto) {
        promessaBancoPronto = inicializarBanco().catch(erro => {
            logErroSeguro('[db:migration] inicializacao incompleta', erro);
            throw erro;
        });
    }
    return promessaBancoPronto;
}

/* ============================================================================
 * FUNÇÕES AUXILIARES (HELPERS)
 * ============================================================================ */

// Responde a requisição com JSON
function enviarJson(res, status, dados) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(dados));
}

// Converte string do corpo da requisição em objeto JSON
function coletarJson(corpo) {
    try {
        return corpo ? JSON.parse(corpo) : {};
    } catch (err) {
        return {};
    }
}

// Garante conversão numérica de campos de produto
// Valida a lista de variantes/modelos de um produto vinda do admin:
// remove vazios, remove duplicados e limita a 100 (regra de negócio da loja)
// Cada variante agora é um objeto: { nome, imagem (url ou null), estoque (número ou null = usa estoque geral) }.
// Aceita também o formato antigo (apenas strings) para manter compatibilidade com produtos já cadastrados.
function sanitizarVariantes(lista) {
    if (!Array.isArray(lista)) return [];
    const vistos = new Set();
    const limpas = [];
    for (const item of lista) {
        let nome, imagem = null, estoque = null;
        if (item && typeof item === 'object') {
            nome = String(item.nome || '').trim();
            imagem = item.imagem ? String(item.imagem) : null;
            estoque = (item.estoque === null || item.estoque === undefined || item.estoque === '')
                ? null : Math.max(0, Number(item.estoque) || 0);
        } else {
            nome = String(item || '').trim();
        }
        if (!nome || vistos.has(nome)) continue;
        vistos.add(nome);
        limpas.push({ nome, imagem, estoque });
        if (limpas.length >= 100) break;
    }
    return limpas;
}

function sanitizarTagsProduto(lista) {
    const permitidas = new Set(['novo', 'queima', 'exclusivo', 'promocao-limitada']);
    if (!Array.isArray(lista)) return [];
    const limpas = [];
    for (const tag of lista) {
        const valor = String(tag || '').trim();
        if (permitidas.has(valor) && !limpas.includes(valor)) limpas.push(valor);
    }
    return limpas;
}

function criarSlug(valor) {
    return String(valor || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 150) || `categoria-${Date.now()}`;
}

async function validarCategoriaId(categoriaId) {
    if (categoriaId === null || categoriaId === undefined || categoriaId === '') return null;
    const id = Number(categoriaId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Categoria invalida.');
    const [rows] = await db.execute('SELECT id FROM categorias WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) throw new Error('Categoria invalida.');
    return id;
}

async function resolverImagemCategoria(dados, imagemAtual = null) {
    if (dados.remover_imagem) return null;
    if (dados.imagem_base64) {
        const base64 = String(dados.imagem_base64 || '');
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(base64)) {
            throw new Error('Formato de imagem invalido.');
        }
        return await imageStorage.salvarImagemBase64(base64, 'categoria');
    }
    return imagemAtual || null;
}

function normalizarProduto(produto) {
    let variantes = [];
    try {
        const parsed = JSON.parse(produto.variantes || '[]');
        if (Array.isArray(parsed)) {
            variantes = parsed
                .map(v => (v && typeof v === 'object')
                    ? { nome: String(v.nome || '').trim(), imagem: v.imagem || null, estoque: (v.estoque === null || v.estoque === undefined) ? null : Number(v.estoque) }
                    : { nome: String(v || '').trim(), imagem: null, estoque: null })
                .filter(v => v.nome);
        }
    } catch (e) {
        variantes = [];
    }
    if (variantes.length === 0) variantes = [{ nome: 'Padrão', imagem: null, estoque: null }];

    let produtoTags = [];
    try {
        produtoTags = sanitizarTagsProduto(JSON.parse(produto.produto_tags || '[]'));
    } catch (e) {
        produtoTags = [];
    }

    const estoqueGeral = Number(produto.estoque || 0);
    // Estoque total exibido na vitrine: soma do estoque específico de cada versão (quando definido)
    // ou o estoque geral, no caso de produto sem controle de estoque por versão.
    const usaEstoquePorVersao = variantes.some(v => v.estoque !== null);
    const estoqueTotal = usaEstoquePorVersao
        ? variantes.reduce((soma, v) => soma + (v.estoque !== null ? v.estoque : 0), 0)
        : estoqueGeral;

    return {
        ...produto,
        preco: Number(produto.preco || 0),
        preco_promocional: Number(produto.preco_promocional || 0),
        promocao_ativa: Boolean(produto.promocao_ativa),
        frete: Number(produto.frete || 0),
        frete_promocional: Number(produto.frete_promocional || 0),
        frete_promocao_ativa: Boolean(produto.frete_promocao_ativa),
        estoque: estoqueGeral,
        estoque_total: estoqueTotal,
        vendas: Number(produto.vendas_iniciais || 0) + Number(produto.vendas_confirmadas || 0),
        max_parcelas: Number(produto.max_parcelas || 12),
        juros_mensal: Number(produto.juros_mensal || 0),
        variantes,
        produto_tags: produtoTags,
        categoria_id: produto.categoria_id ? Number(produto.categoria_id) : null,
        categoria_nome: produto.categoria_nome || null,
        categoria_slug: produto.categoria_slug || null
    };
}

function produtoTemPromocaoValida(produto) {
    const preco = Math.max(0, Number(produto.preco || 0));
    const promocional = Number(produto.preco_promocional || 0);
    return Number(produto.promocao_ativa) === 1 && promocional > 0 && promocional < preco;
}

function primeiraFotoProduto(produto) {
    try {
        const fotos = JSON.parse(produto.foto || '[]');
        if (Array.isArray(fotos)) return fotos[0] || null;
    } catch (e) {}
    return produto.foto || null;
}

function normalizarProdutoCatalogo(produto) {
    let produtoTags = [];
    try {
        produtoTags = sanitizarTagsProduto(JSON.parse(produto.produto_tags || '[]'));
    } catch (e) {
        produtoTags = [];
    }
    const preco = Number(produto.preco || 0);
    const precoPromocional = Number(produto.preco_promocional || 0);
    const promocaoValida = produtoTemPromocaoValida(produto);
    return {
        id: Number(produto.id || 0),
        nome: produto.nome || '',
        preco,
        preco_promocional: precoPromocional,
        promocao_ativa: Boolean(produto.promocao_ativa),
        promocao_valida: promocaoValida,
        preco_efetivo: promocaoValida ? precoPromocional : preco,
        foto: primeiraFotoProduto(produto),
        produto_tags: produtoTags,
        categoria_id: produto.categoria_id ? Number(produto.categoria_id) : null,
        categoria_nome: produto.categoria_nome || null,
        categoria_slug: produto.categoria_slug || null,
        descricao: produto.descricao || '',
        estoque_total: Number(produto.estoque || 0)
    };
}

async function consultarCategoriasPublicas() {
    const inicio = agoraMs();
    const [rows] = await db.execute(
        `SELECT c.id, c.nome, c.slug, c.descricao, c.imagem_url, c.ordem,
                COUNT(p.id) AS produtos
         FROM categorias c
         LEFT JOIN produtos p ON p.categoria_id = c.id
         WHERE c.ativo = 1
         GROUP BY c.id, c.nome, c.slug, c.descricao, c.imagem_url, c.ordem
         ORDER BY c.ordem ASC, c.nome ASC`
    );
    const ms = agoraMs() - inicio;
    logPerf('loja_categorias_query', { ms });
    return { dados: rows.map(c => ({ ...c, produtos: Number(c.produtos || 0) })), ms };
}

async function consultarProdutosCatalogo() {
    const inicio = agoraMs();
    const [rows] = await db.execute(`
        SELECT p.id, p.nome, p.preco, p.preco_promocional, p.promocao_ativa,
               p.foto, p.produto_tags, p.categoria_id, c.nome AS categoria_nome,
               c.slug AS categoria_slug, LEFT(p.descricao, 240) AS descricao, p.estoque
        FROM produtos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        ORDER BY p.id DESC
    `);
    const ms = agoraMs() - inicio;
    logPerf('loja_produtos_query', { ms, count: rows.length });
    return { dados: (rows || []).map(normalizarProdutoCatalogo), ms };
}

// Retorna o estoque disponível para a versão escolhida (ou o estoque geral, se a versão
// não tiver estoque próprio definido / produto não tiver versões).
function estoqueDaVariante(produtoNormalizado, nomeVariante) {
    const variante = (produtoNormalizado.variantes || []).find(v => v.nome === nomeVariante);
    if (variante && variante.estoque !== null) return variante.estoque;
    const estoqueGeral = Number(produtoNormalizado.estoque || 0);
    return estoqueGeral > 0 ? estoqueGeral : Number.POSITIVE_INFINITY;
}

function normalizarNomeVariantePedido(valor) {
    if (valor && typeof valor === 'object') return String(valor.nome || 'Padrão').trim() || 'Padrão';
    return String(valor || 'Padrão').trim() || 'Padrão';
}

// Desconta (delta negativo) ou soma estoque de uma versão específica ou do estoque geral do produto.
// Retorna false se não havia estoque suficiente.
async function ajustarEstoque(produtoId, nomeVariante, delta) {
    const [rows] = await db.execute('SELECT estoque, variantes FROM produtos WHERE id = ?', [produtoId]);
    if (!rows.length) return false;
    let variantes = [];
    try { const parsed = JSON.parse(rows[0].variantes || '[]'); if (Array.isArray(parsed)) variantes = parsed; } catch (e) { variantes = []; }
    const variante = variantes.find(v => v && typeof v === 'object' && v.nome === nomeVariante && v.estoque !== null && v.estoque !== undefined);

    if (variante) {
        const novoValor = Number(variante.estoque) + delta;
        if (novoValor < 0) return false;
        variante.estoque = novoValor;
        await db.execute('UPDATE produtos SET variantes = ? WHERE id = ?', [JSON.stringify(variantes), produtoId]);
        return true;
    }

    const estoqueAtual = Number(rows[0].estoque || 0);
    if (delta < 0 && estoqueAtual <= 0) return true;

    const novoEstoqueGeral = estoqueAtual + delta;
    if (novoEstoqueGeral < 0) return false;
    await db.execute('UPDATE produtos SET estoque = ? WHERE id = ?', [novoEstoqueGeral, produtoId]);
    return true;
}

function escaparHtml(valor) { return String(valor || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

// O editor rico só pode gravar formatação, nunca atributos, scripts ou links.
// Isso evita que texto administrativo execute código no navegador do cliente.
function limparHtmlRico(valor) {
    const permitidas = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote']);
    return String(valor || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, tag => {
            const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)/i);
            if (!match || !permitidas.has(match[2].toLowerCase())) return '';
            return `<${match[1] ? '/' : ''}${match[2].toLowerCase()}>`;
        });
}

function precoEfetivo(produto) {
    const precoBase = Math.max(0, Number(produto.preco || 0));
    const promocional = Number(produto.preco_promocional || 0);
    return produtoTemPromocaoValida(produto) ? promocional : precoBase;
}

function freteEfetivo(produto) {
    const freteBase = Math.max(0, Number(produto.frete || 0));
    const promocional = Number(produto.frete_promocional || 0);
    return Number(produto.frete_promocao_ativa) === 1 && promocional >= 0 && promocional < freteBase ? promocional : freteBase;
}

// Cria hash seguro para a senha do usuário
function criarHashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(senha || ''), salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}

// Valida senha informada contra o hash salvo
function senhaConfere(senhaInformada, senhaSalva) {
    const senha = String(senhaInformada || '');
    const salva = String(senhaSalva || '');

    // Compatibilidade com senhas antigas sem hash
    if (!salva.startsWith('pbkdf2:')) return senha === salva;

    const partes = salva.split(':');
    if (partes.length !== 3) return false;

    const [, salt, hash] = partes;
    const hashInformado = crypto.pbkdf2Sync(senha, salt, 100000, 64, 'sha512').toString('hex');
    const bufferInformado = Buffer.from(hashInformado, 'hex');
    const bufferSalvo = Buffer.from(hash, 'hex');

    if (bufferInformado.length !== bufferSalvo.length) return false;
    return crypto.timingSafeEqual(bufferInformado, bufferSalvo);
}

function senhaForte(senha) {
    const valor = String(senha || '');
    return valor.length >= 8 && /[A-Za-z]/.test(valor) && /\d/.test(valor);
}

function assinaturaSessaoAdmin(payloadCodificado) {
    if (!SESSION_SECRET) throw erroInfraestrutura('SESSION_SECRET nao configurado.');
    return crypto.createHmac('sha256', SESSION_SECRET).update(payloadCodificado).digest('base64url');
}

function criarTokenSessaoAdmin() {
    const payload = Buffer.from(JSON.stringify({
        type: 'admin_env',
        exp: Date.now() + SESSION_TTL_MS
    })).toString('base64url');
    return `${payload}.${assinaturaSessaoAdmin(payload)}`;
}

function tokenSessaoAdminValido(token) {
    if (!SESSION_SECRET || !token) return false;
    const partes = String(token).split('.');
    if (partes.length !== 2 || !partes[0] || !partes[1]) return false;
    try {
        const assinaturaRecebida = Buffer.from(partes[1]);
        const assinaturaEsperada = Buffer.from(assinaturaSessaoAdmin(partes[0]));
        if (assinaturaRecebida.length !== assinaturaEsperada.length) return false;
        if (!crypto.timingSafeEqual(assinaturaRecebida, assinaturaEsperada)) return false;
        const payload = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
        return payload?.type === 'admin_env' && Number.isFinite(Number(payload.exp)) && Number(payload.exp) > Date.now();
    } catch (e) {
        return false;
    }
}

function usuarioAdminEnvPublico() {
    return { id: 0, nome: 'Administrador', email: ADMIN_USER, is_admin: 1 };
}

function obterSessaoAdminEnv(req) {
    const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
    return tokenSessaoAdminValido(token) ? usuarioAdminEnvPublico() : null;
}

function criarSessaoAdminEnv(req, res) {
    const token = criarTokenSessaoAdmin();
    anexarCookie(res, cookieSessao(req, '', 0));
    anexarCookie(res, cookieSessaoAdmin(req, token, Math.floor(SESSION_TTL_MS / 1000)));
    return usuarioAdminEnvPublico();
}

async function criarSessaoUsuario(req, res, usuario) {
    if (tabelaAusente(diagnosticoBanco, 'sessoes')) {
        throw erroInfraestrutura('Tabela sessoes ausente.');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expira = new Date(Date.now() + SESSION_TTL_MS);
    const versao = Number(usuario.sessao_versao || 0);
    await db.execute(
        'INSERT INTO sessoes (usuario_id, token_hash, sessao_versao, expira_em, user_agent) VALUES (?, ?, ?, ?, ?)',
        [usuario.id, tokenHash, versao, expira, String(req.headers['user-agent'] || '').slice(0, 500)]
    );
    anexarCookie(res, cookieSessao(req, token, Math.floor(SESSION_TTL_MS / 1000)));
    anexarCookie(res, cookieSessaoAdmin(req, '', 0));
    return token;
}

async function obterSessaoAtual(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    if (tabelaAusente(diagnosticoBanco, 'sessoes')) {
        throw erroInfraestrutura('Tabela sessoes ausente.');
    }
    const tokenHash = hashToken(token);
    const [rows] = await db.execute(
        `SELECT s.id AS sessao_id, s.expira_em, s.revogado_em, s.sessao_versao,
                u.id, u.nome, u.cpf, u.cep, u.endereco, u.telefone, u.email, u.foto, u.is_admin, u.sessao_versao AS usuario_sessao_versao
         FROM sessoes s
         INNER JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token_hash = ? LIMIT 1`,
        [tokenHash]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.revogado_em || new Date(row.expira_em).getTime() <= Date.now()) return null;
    if (Number(row.sessao_versao || 0) !== Number(row.usuario_sessao_versao || 0)) return null;
    await db.execute('UPDATE sessoes SET ultimo_uso_em = NOW() WHERE id = ?', [row.sessao_id]);
    return {
        id: row.id, nome: row.nome, cpf: row.cpf, cep: row.cep, endereco: row.endereco,
        telefone: row.telefone, email: row.email, foto: row.foto, is_admin: row.is_admin,
        sessao_id: row.sessao_id
    };
}

async function revogarSessaoAtual(req, res) {
    const token = parseCookies(req)[SESSION_COOKIE];
    anexarCookie(res, cookieSessao(req, '', 0));
    anexarCookie(res, cookieSessaoAdmin(req, '', 0));
    if (token && tabelaAusente(diagnosticoBanco, 'sessoes')) {
        throw erroInfraestrutura('Tabela sessoes ausente.');
    }
    if (token) await db.execute('UPDATE sessoes SET revogado_em = NOW() WHERE token_hash = ?', [hashToken(token)]);
}

async function revogarSessoesUsuario(usuarioId) {
    if (tabelaAusente(diagnosticoBanco, 'sessoes') || colunaAusente(diagnosticoBanco, 'usuarios_sessao_versao')) {
        throw erroInfraestrutura('Estrutura de sessoes ausente.');
    }
    await db.execute('UPDATE sessoes SET revogado_em = NOW() WHERE usuario_id = ? AND revogado_em IS NULL', [usuarioId]);
    await db.execute('UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = ?', [usuarioId]);
}

async function clienteAutorizado(req, idEsperado) {
    if (tokenClienteValido(req, idEsperado) || temAcessoAdmin(req) || obterSessaoAdminEnv(req)) return true;
    const sessao = await obterSessaoAtual(req);
    return Boolean(sessao && (Number(sessao.id) === Number(idEsperado) || Number(sessao.is_admin) === 1));
}

function somenteDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function cpfValido(valor) {
    const cpf = somenteDigitos(valor);
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
    let d1 = 11 - (soma % 11);
    if (d1 >= 10) d1 = 0;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
    let d2 = 11 - (soma % 11);
    if (d2 >= 10) d2 = 0;
    return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function validarEnderecoEntrega(dados) {
    const entrega = dados.entrega || {};
    const campos = ['nome_destinatario', 'cpf', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado'];
    for (const campo of campos) {
        if (!String(entrega[campo] || '').trim()) return { ok: false, erro: `Campo obrigatorio ausente: ${campo}` };
    }
    if (!cpfValido(entrega.cpf)) return { ok: false, erro: 'CPF de entrega invalido.' };
    if (somenteDigitos(entrega.cep).length !== 8) return { ok: false, erro: 'CEP de entrega invalido.' };
    if (!/^[A-Za-z]{2}$/.test(String(entrega.estado || '').trim())) return { ok: false, erro: 'Estado de entrega invalido.' };
    return {
        ok: true,
        entrega: {
            nome_destinatario: String(entrega.nome_destinatario).trim(),
            cpf: somenteDigitos(entrega.cpf),
            telefone: somenteDigitos(entrega.telefone),
            cep: somenteDigitos(entrega.cep),
            logradouro: String(entrega.logradouro).trim(),
            numero: String(entrega.numero).trim(),
            complemento: String(entrega.complemento || '').trim(),
            bairro: String(entrega.bairro).trim(),
            cidade: String(entrega.cidade).trim(),
            estado: String(entrega.estado).trim().toUpperCase().slice(0, 2)
        }
    };
}

async function validarGoogleCredential(credential) {
    if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID nao configurado.');
    if (!credential) throw new Error('Credential Google ausente.');
    if (!googleOAuthClient) googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await googleOAuthClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID
    });
    const perfil = ticket.getPayload();
    if (!perfil) throw new Error('Payload Google ausente.');
    if (perfil.email_verified !== true && perfil.email_verified !== 'true') throw new Error('E-mail Google nao verificado.');
    return perfil;
}

// Verifica se o token informado no header pertence ao admin
function temAcessoAdmin(req) {
    if (!ADMIN_TOKEN) return false;
    return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

async function possuiAcessoAdmin(req) {
    if (temAcessoAdmin(req) || obterSessaoAdminEnv(req)) return true;
    const sessao = await obterSessaoAtual(req);
    return Boolean(sessao && Number(sessao.is_admin) === 1);
}

// Bloqueia acesso caso não seja admin
async function exigirAcessoAdmin(req, res) {
    try {
        if (await possuiAcessoAdmin(req)) return true;
    } catch (e) {
        logErroSeguro('[auth:login] ERRO stage=admin_session_read', e);
        enviarJson(res, e?.infraestrutura ? 503 : 500, { erro: 'Nao foi possivel validar acesso administrativo agora.' });
        return false;
    }
    enviarJson(res, 403, { erro: 'Acesso administrativo necessario.' });
    return false;
}

// Descobre o domínio original da requisição (útil para URLs de Webhook)
function descobrirOrigemPublica(req) {
    const protocolo = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${protocolo}://${host}`;
}

// Serve arquivos estáticos da pasta /public
function servirArquivo(req, res, urlParse) {
    let arquivo = urlParse === '/' ? '/index.html' : decodeURIComponent(urlParse);
    const caminhoArquivo = path.normalize(path.join(pastaPublic, arquivo));

    if (!caminhoArquivo.startsWith(pastaPublic)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Acesso negado.');
        return;
    }

    const tipos = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
    };

    fs.readFile(caminhoArquivo, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Arquivo nao encontrado no servidor.');
            return;
        }
        const ext = path.extname(caminhoArquivo).toLowerCase();
        const cacheControl = ['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)
            ? 'public, max-age=3600'
            : 'no-cache';
        res.writeHead(200, {
            'Content-Type': tipos[ext] || 'application/octet-stream',
            'Cache-Control': cacheControl
        });
        res.end(content);
    });
}

/* ============================================================================
 * MANIPULADOR PRINCIPAL DE REQUISIÇÕES (API HANDLER)
 * ============================================================================ */
function handleRequest(req, res) {
    // Configurações de CORS
    const origem = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origem || '*');
    if (origem) res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, X-User-Token');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const urlParse = req.url.split('?')[0];

    // Rota de fotos locais (Fallback)
    if (req.method === 'GET' && urlParse.startsWith('/uploads/')) {
        const caminhoFoto = path.normalize(path.join(imageStorage.pastaUploads, '..', urlParse));
        if (!caminhoFoto.startsWith(imageStorage.pastaUploads)) {
            res.writeHead(403);
            res.end();
            return;
        }
        fs.readFile(caminhoFoto, (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            const tiposUpload = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif', '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime' };
            res.writeHead(200, { 'Content-Type': tiposUpload[path.extname(caminhoFoto).toLowerCase()] || 'application/octet-stream' });
            res.end(data);
        });
        return;
    }

    let corpo = '';
    let corpoMuitoGrande = false;
    req.on('data', chunk => {
        corpo += chunk.toString();
        if (corpo.length > 8 * 1024 * 1024) {
            corpoMuitoGrande = true;
            req.destroy();
        }
    });

    req.on('end', async () => {
        if (corpoMuitoGrande) return enviarJson(res, 413, { erro: 'Requisicao muito grande.' });
        if (urlParse.startsWith('/api/')) {
            const inicioDbReady = agoraMs();
            try {
                await garantirBancoPronto();
                req.perfDbReadyMs = agoraMs() - inicioDbReady;
                logPerf('db_ready_ms', { path: urlParse, ms: req.perfDbReadyMs });
            } catch (erroBanco) {
                logErroSeguro('[db:migration] requisicao bloqueada por banco incompleto', erroBanco, { path: urlParse });
                if (urlParse === '/api/admin/diagnostico') {
                    diagnosticoBanco = diagnosticoBanco || { conectado: false, tabelas: {}, colunas: {}, erro: erroSeguro(erroBanco) };
                } else {
                    return enviarJson(res, 503, { erro: 'Banco de dados temporariamente indisponivel. Tente novamente em instantes.' });
                }
            }
        }
        /* -------------------------------------------------------------------
         * ROTAS DE PRODUTOS
         * ------------------------------------------------------------------- */

        if (urlParse === '/api/categorias' && req.method === 'GET') {
            try {
                const categoriasPublicas = await consultarCategoriasPublicas();
                setServerTiming(res, [
                    { name: 'dbready', dur: req.perfDbReadyMs || 0 },
                    { name: 'categories', dur: categoriasPublicas.ms }
                ]);
                enviarJson(res, 200, categoriasPublicas.dados);
            } catch (err) {
                logErroSeguro('[categorias] erro ao listar publicas', err);
                enviarJson(res, 500, { erro: 'Erro ao carregar categorias.' });
            }
            return;
        }

        if (urlParse === '/api/loja/bootstrap' && req.method === 'GET') {
            const inicioBootstrap = agoraMs();
            try {
                const [produtosPublicos, categoriasPublicas] = await Promise.all([
                    consultarProdutosCatalogo(),
                    consultarCategoriasPublicas()
                ]);
                const totalMs = agoraMs() - inicioBootstrap;
                logPerf('loja_bootstrap', {
                    total_ms: totalMs,
                    produtos: produtosPublicos.dados.length,
                    categorias: categoriasPublicas.dados.length
                });
                setServerTiming(res, [
                    { name: 'dbready', dur: req.perfDbReadyMs || 0 },
                    { name: 'products', dur: produtosPublicos.ms },
                    { name: 'categories', dur: categoriasPublicas.ms },
                    { name: 'total', dur: totalMs }
                ]);
                res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=30');
                enviarJson(res, 200, { produtos: produtosPublicos.dados, categorias: categoriasPublicas.dados });
            } catch (err) {
                logErroSeguro('[loja] erro ao carregar bootstrap', err);
                enviarJson(res, 500, { erro: 'Erro ao carregar loja.' });
            }
            return;
        }

        if (urlParse === '/api/admin/categorias' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const [rows] = await db.execute(
                    `SELECT c.*, COUNT(p.id) AS produtos
                     FROM categorias c
                     LEFT JOIN produtos p ON p.categoria_id = c.id
                     GROUP BY c.id
                     ORDER BY c.ordem ASC, c.nome ASC`
                );
                enviarJson(res, 200, rows.map(c => ({ ...c, produtos: Number(c.produtos || 0) })));
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao carregar categorias.' });
            }
            return;
        }

        if (urlParse === '/api/admin/categorias' && req.method === 'POST') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const dados = coletarJson(corpo);
                const nome = String(dados.nome || '').trim();
                if (!nome) return enviarJson(res, 400, { erro: 'Informe o nome da categoria.' });
                const slug = criarSlug(dados.slug || nome);
                const imagemUrl = await resolverImagemCategoria(dados);
                const [result] = await db.execute(
                    `INSERT INTO categorias (nome, slug, descricao, imagem_url, ativo, ordem, parent_id, atualizado_em)
                     VALUES (?, ?, ?, ?, ?, ?, NULL, NOW())`,
                    [nome, slug, dados.descricao || null, imagemUrl, dados.ativo === false ? 0 : 1, Number(dados.ordem || 0)]
                );
                enviarJson(res, 201, { sucesso: true, id: result.insertId });
            } catch (err) {
                logErroSeguro('[categorias] erro ao criar admin', err);
                enviarJson(res, 400, { erro: err.code === 'ER_DUP_ENTRY' ? 'Slug de categoria ja existe.' : 'Nao foi possivel criar categoria.' });
            }
            return;
        }

        if (urlParse.match(/^\/api\/admin\/categorias\/\d+$/) && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                const nome = String(dados.nome || '').trim();
                if (!nome) return enviarJson(res, 400, { erro: 'Informe o nome da categoria.' });
                const slug = criarSlug(dados.slug || nome);
                const [atuais] = await db.execute('SELECT imagem_url FROM categorias WHERE id = ? LIMIT 1', [id]);
                if (!atuais.length) return enviarJson(res, 404, { erro: 'Categoria nao encontrada.' });
                const imagemUrl = await resolverImagemCategoria(dados, atuais[0].imagem_url);
                const [result] = await db.execute(
                    `UPDATE categorias SET nome=?, slug=?, descricao=?, imagem_url=?, ativo=?, ordem=?, atualizado_em=NOW() WHERE id=?`,
                    [nome, slug, dados.descricao || null, imagemUrl, dados.ativo ? 1 : 0, Number(dados.ordem || 0), id]
                );
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                logErroSeguro('[categorias] erro ao editar admin', err);
                enviarJson(res, 400, { erro: err.code === 'ER_DUP_ENTRY' ? 'Slug de categoria ja existe.' : 'Nao foi possivel editar categoria.' });
            }
            return;
        }

        if (urlParse.match(/^\/api\/admin\/categorias\/\d+$/) && req.method === 'DELETE') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const id = urlParse.split('/').pop();
                const [produtos] = await db.execute('SELECT COUNT(*) total FROM produtos WHERE categoria_id = ?', [id]);
                const total = Number(produtos[0]?.total || 0);
                if (total > 0) {
                    return enviarJson(res, 409, { erro: `Esta categoria possui ${total} produtos associados. Reatribua os produtos ou desative a categoria antes de exclui-la.` });
                }
                const [result] = await db.execute('DELETE FROM categorias WHERE id = ?', [id]);
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Nao foi possivel excluir categoria.' });
            }
            return;
        }

        // GET /api/produtos — Listar todos os produtos
        if (urlParse === '/api/produtos' && req.method === 'GET') {
            try {
                const inicioProdutos = agoraMs();
                let rows;
                try {
                    [rows] = await db.execute(`
                        SELECT p.id, p.nome, p.preco, p.preco_promocional, p.promocao_ativa, p.frete, p.frete_promocional, p.frete_promocao_ativa, p.foto, p.max_parcelas,
                               p.juros_mensal, p.variantes, p.estoque, p.vendas_iniciais, p.vendas_confirmadas,
                               p.produto_tags, p.categoria_id, c.nome AS categoria_nome, c.slug AS categoria_slug,
                               LEFT(p.descricao, 240) AS descricao
                        FROM produtos p
                        LEFT JOIN categorias c ON c.id = p.categoria_id
                        ORDER BY p.id DESC
                    `);
                } catch (erroColunaNova) {
                    [rows] = await db.execute(`
                        SELECT id, nome, preco, preco_promocional, promocao_ativa, frete, frete_promocional, frete_promocao_ativa, foto, max_parcelas,
                               juros_mensal, variantes, estoque, vendas_iniciais, vendas_confirmadas,
                               LEFT(descricao, 240) AS descricao
                        FROM produtos
                        ORDER BY id DESC
                    `);
                    rows = rows.map(row => ({ ...row, produto_tags: '[]' }));
                }
                const msProdutos = agoraMs() - inicioProdutos;
                logPerf('produtos_query', { ms: msProdutos, count: (rows || []).length });
                setServerTiming(res, [
                    { name: 'dbready', dur: req.perfDbReadyMs || 0 },
                    { name: 'products', dur: msProdutos }
                ]);
                enviarJson(res, 200, (rows || []).map(normalizarProduto));
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        // GET /api/produtos/:id — Buscar produto por ID
        if (urlParse.startsWith('/api/produtos/') && !urlParse.endsWith('/comentarios') && req.method === 'GET') {
            const id = urlParse.split('/').pop();
            try {
                const inicioProduto = agoraMs();
                const [rows] = await db.execute(
                    `SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug
                     FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
                     WHERE p.id = ?`,
                    [id]
                );
                const msProduto = agoraMs() - inicioProduto;
                logPerf('produto_query', { id, ms: msProduto });
                setServerTiming(res, [
                    { name: 'dbready', dur: req.perfDbReadyMs || 0 },
                    { name: 'product', dur: msProduto }
                ]);
                if (rows.length === 0) {
                    res.setHeader('Cache-Control', 'no-store');
                    return enviarJson(res, 404, { erro: 'Produto nao encontrado.' });
                }
                res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=30');
                enviarJson(res, 200, normalizarProduto(rows[0]));
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        // POST /api/produtos — Cadastrar novo produto (Admin)
        if (urlParse === '/api/produtos' && req.method === 'POST') {
            if (!(await exigirAcessoAdmin(req, res))) return;

            try {
                const dados = coletarJson(corpo);
                // Se o admin enviou fotosOrdenadas (lista mista existentes+novas), processa mantendo a sequência
                let fotosFinais;
                if (Array.isArray(dados.fotosOrdenadas) && dados.fotosOrdenadas.length > 0) {
                    fotosFinais = [];
                    for (const item of dados.fotosOrdenadas) {
                        if (item.existente) {
                            fotosFinais.push(item.existente);
                        } else if (item.nova) {
                            const url = await imageStorage.salvarImagemBase64(item.nova, 'prod');
                            if (url) fotosFinais.push(url);
                        }
                    }
                } else {
                    const fotos = await imageStorage.salvarVariasImagensBase64(dados.fotosBase64, 'prod');
                    fotosFinais = fotos;
                }
                if (!fotosFinais.length) fotosFinais = ['https://via.placeholder.com/450?text=Core+Case'];
                const variantesFinais = sanitizarVariantes(dados.variantes);
                const tagsFinais = sanitizarTagsProduto(dados.produto_tags);
                const categoriaId = await validarCategoriaId(dados.categoria_id);

                const [result] = await db.execute(
                    `INSERT INTO produtos (nome, preco, preco_promocional, promocao_ativa, frete, frete_promocional, frete_promocao_ativa, estoque, vendas_iniciais, descricao, sobre, informacoes, foto, max_parcelas, juros_mensal, variantes, produto_tags, categoria_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        dados.nome,
                        Number(dados.preco || 0),
                        dados.promocao_ativa ? Number(dados.preco_promocional || 0) : null,
                        dados.promocao_ativa ? 1 : 0,
                        Number(dados.frete || 0),
                        dados.frete_promocao_ativa ? Number(dados.frete_promocional || 0) : null,
                        dados.frete_promocao_ativa ? 1 : 0,
                        Math.max(0, Number(dados.estoque || 0)),
                        Math.max(0, Number(dados.vendas_iniciais || 0)),
                        limparHtmlRico(dados.descricao), limparHtmlRico(dados.sobre), limparHtmlRico(dados.informacoes),
                        JSON.stringify(fotosFinais),
                        Number(dados.max_parcelas || 12),
                        Number(dados.juros_mensal || 0),
                        JSON.stringify(variantesFinais),
                        JSON.stringify(tagsFinais),
                        categoriaId
                    ]
                );

                enviarJson(res, 201, { sucesso: true, id: result.insertId });
            } catch (e) {
                console.error('Erro ao cadastrar produto:', e);
                enviarJson(res, 500, { erro: e.message });
            }
            return;
        }

        // PUT /api/produtos/:id — Editar produto existente (Admin)
        if (urlParse.startsWith('/api/produtos/') && !urlParse.includes('/comentarios') && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;

            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                // Se o admin enviou fotosOrdenadas (lista mista existentes+novas), processa mantendo a sequência
                let fotosFinais;
                if (Array.isArray(dados.fotosOrdenadas) && dados.fotosOrdenadas.length > 0) {
                    fotosFinais = [];
                    for (const item of dados.fotosOrdenadas) {
                        if (item.existente) {
                            fotosFinais.push(item.existente);
                        } else if (item.nova) {
                            const url = await imageStorage.salvarImagemBase64(item.nova, 'prod');
                            if (url) fotosFinais.push(url);
                        }
                    }
                } else {
                    const novasFotos = await imageStorage.salvarVariasImagensBase64(dados.fotosBase64, 'prod');
                    const fotosExistentes = Array.isArray(dados.fotosExistentes) ? dados.fotosExistentes : [];
                    fotosFinais = novasFotos.length ? [...fotosExistentes, ...novasFotos] : fotosExistentes;
                }
                const variantesFinais = sanitizarVariantes(dados.variantes);
                const tagsFinais = sanitizarTagsProduto(dados.produto_tags);
                const categoriaId = await validarCategoriaId(dados.categoria_id);

                const [result] = await db.execute(
                    `UPDATE produtos SET nome = ?, preco = ?, preco_promocional = ?, promocao_ativa = ?, frete = ?, frete_promocional = ?, frete_promocao_ativa = ?, estoque = ?, vendas_iniciais = ?, descricao = ?, sobre = ?, informacoes = ?, foto = ?, max_parcelas = ?, juros_mensal = ?, variantes = ?, produto_tags = ?, categoria_id = ? WHERE id = ?`,
                    [
                        dados.nome,
                        Number(dados.preco || 0),
                        dados.promocao_ativa ? Number(dados.preco_promocional || 0) : null, dados.promocao_ativa ? 1 : 0,
                        Number(dados.frete || 0), dados.frete_promocao_ativa ? Number(dados.frete_promocional || 0) : null, dados.frete_promocao_ativa ? 1 : 0,
                        Math.max(0, Number(dados.estoque || 0)), Math.max(0, Number(dados.vendas_iniciais || 0)),
                        limparHtmlRico(dados.descricao), limparHtmlRico(dados.sobre), limparHtmlRico(dados.informacoes),
                        JSON.stringify(fotosFinais.length ? fotosFinais : ['https://via.placeholder.com/450?text=Core+Case']),
                        Number(dados.max_parcelas || 12),
                        Number(dados.juros_mensal || 0),
                        JSON.stringify(variantesFinais),
                        JSON.stringify(tagsFinais),
                        categoriaId,
                        id
                    ]
                );
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (e) {
                console.error("ERRO AO EDITAR PRODUTO:", e);
                enviarJson(res, 500, { erro: e.message, stack: e.stack });
            }
            return;
        }

        // GET/POST /api/produtos/:id/comentarios
        if (urlParse.match(/^\/api\/produtos\/\d+\/comentarios$/) && req.method === 'GET') {
            const produtoId = urlParse.split('/')[3];
            try {
                const [comentarios] = await db.execute(`SELECT c.*, u.nome AS usuario_nome, u.foto AS usuario_foto FROM comentarios_produto c LEFT JOIN usuarios u ON u.id=c.usuario_id WHERE c.produto_id=? ORDER BY c.id DESC`, [produtoId]);
                for (const comentario of comentarios) {
                    const [midias] = await db.execute('SELECT id, tipo, arquivo FROM comentario_midias WHERE comentario_id=?', [comentario.id]);
                    comentario.midias = midias;
                    comentario.nome = comentario.usuario_nome || comentario.nome_manual || 'Cliente';
                    comentario.foto = comentario.usuario_foto || comentario.foto_manual || '';
                }
                const [media] = await db.execute('SELECT COUNT(*) quantidade, COALESCE(AVG(nota),0) nota FROM comentarios_produto WHERE produto_id=?', [produtoId]);
                return enviarJson(res, 200, { comentarios, media: { quantidade: Number(media[0].quantidade), nota: Number(media[0].nota) } });
            } catch (err) { return enviarJson(res, 500, { erro: 'Erro ao carregar avaliações.' }); }
        }
        if (urlParse.match(/^\/api\/produtos\/\d+\/comentarios$/) && req.method === 'POST') {
            const produtoId = urlParse.split('/')[3]; const dados = coletarJson(corpo);
            let admin = false;
            try {
                admin = await possuiAcessoAdmin(req);
            } catch (err) {
                logErroSeguro('[comentarios] ERRO stage=admin_permission_read', err);
                return enviarJson(res, err?.infraestrutura ? 503 : 500, { erro: 'Nao foi possivel validar sua permissao agora.' });
            }
            const usuarioId = Number(dados.usuario_id || 0);
            if (!admin && (!usuarioId || !tokenClienteValido(req, usuarioId))) return enviarJson(res, 403, { erro: 'Faça login para avaliar este produto.' });
            const nota = Number(dados.nota);
            if (!Number.isFinite(nota) || nota < 0 || nota > 5 || !String(dados.texto || '').trim()) return enviarJson(res, 400, { erro: 'Informe uma nota entre 0 e 5 e escreva seu comentário.' });
            const imagens = Array.isArray(dados.imagens) ? dados.imagens : []; const videos = Array.isArray(dados.videos) ? dados.videos : [];
            if (imagens.length > 9 || videos.length > 2) return enviarJson(res, 400, { erro: 'Limite: até 9 imagens e 2 vídeos por comentário.' });
            // Base64 adiciona cerca de 33% ao tamanho original.
            if ([...imagens, ...videos].some(m => String(m).length > 80 * 1024 * 1024)) return enviarJson(res, 400, { erro: 'Cada arquivo deve ter no máximo 60 MB.' });
            try {
                const fotoManual = admin && dados.foto_manual ? await imageStorage.salvarImagemBase64(dados.foto_manual, 'avatar-comentario') : null;
                const [resultado] = await db.execute('INSERT INTO comentarios_produto (produto_id, usuario_id, nome_manual, foto_manual, nota, texto) VALUES (?, ?, ?, ?, ?, ?)', [produtoId, usuarioId || null, admin ? (dados.nome_manual || null) : null, fotoManual, nota, escaparHtml(dados.texto).replace(/\n/g, '<br>')]);
                for (const [tipo, lista] of [['imagem', imagens], ['video', videos]]) for (const item of lista) { const url = await imageStorage.salvarMidiaBase64(item, `comentario-${tipo}`); if (url) await db.execute('INSERT INTO comentario_midias (comentario_id, tipo, arquivo) VALUES (?, ?, ?)', [resultado.insertId, tipo, url]); }
                return enviarJson(res, 201, { sucesso: true, id: resultado.insertId });
            } catch (err) { return enviarJson(res, 500, { erro: 'Não foi possível publicar o comentário.' }); }
        }

        // PUT /api/produtos/:produtoId/comentarios/:comentarioId — Editar comentário (Admin)
        if (urlParse.match(/^\/api\/produtos\/\d+\/comentarios\/\d+$/) && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            const partes = urlParse.split('/');
            const produtoId = partes[3];
            const comentarioId = partes[5];
            const dados = coletarJson(corpo);
            const nota = Number(dados.nota);
            if (!Number.isFinite(nota) || nota < 0 || nota > 5 || !String(dados.texto || '').trim()) {
                return enviarJson(res, 400, { erro: 'Informe uma nota entre 0 e 5 e escreva o comentário.' });
            }
            try {
                const fotoManual = dados.foto_manual ? await imageStorage.salvarImagemBase64(dados.foto_manual, 'avatar-comentario') : undefined;
                const camposExtra = fotoManual !== undefined ? ', foto_manual = ?' : '';
                const valores = [dados.nome_manual || null, nota, escaparHtml(dados.texto).replace(/\n/g, '<br>')];
                if (fotoManual !== undefined) valores.push(fotoManual);
                valores.push(comentarioId, produtoId);
                const [result] = await db.execute(
                    `UPDATE comentarios_produto SET nome_manual = ?, nota = ?, texto = ?${camposExtra} WHERE id = ? AND produto_id = ?`,
                    valores
                );

                const imagens = Array.isArray(dados.imagens) ? dados.imagens : [];
                const videos = Array.isArray(dados.videos) ? dados.videos : [];
                for (const [tipo, lista] of [['imagem', imagens], ['video', videos]]) {
                    for (const item of lista) {
                        const url = await imageStorage.salvarMidiaBase64(item, `comentario-${tipo}`);
                        if (url) await db.execute('INSERT INTO comentario_midias (comentario_id, tipo, arquivo) VALUES (?, ?, ?)', [comentarioId, tipo, url]);
                    }
                }
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Não foi possível editar o comentário.' });
            }
            return;
        }

        // DELETE /api/produtos/:produtoId/comentarios/:comentarioId — Apagar comentário (Admin)
        if (urlParse.match(/^\/api\/produtos\/\d+\/comentarios\/\d+$/) && req.method === 'DELETE') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            const partes = urlParse.split('/');
            const produtoId = partes[3];
            const comentarioId = partes[5];
            try {
                await db.execute('DELETE FROM comentario_midias WHERE comentario_id = ?', [comentarioId]);
                const [result] = await db.execute('DELETE FROM comentarios_produto WHERE id = ? AND produto_id = ?', [comentarioId, produtoId]);
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Não foi possível apagar o comentário.' });
            }
            return;
        }

        // DELETE /api/comentarios/midias/:midiaId — Apagar uma mídia específica de um comentário (Admin)
        if (urlParse.match(/^\/api\/comentarios\/midias\/\d+$/) && req.method === 'DELETE') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            const midiaId = urlParse.split('/').pop();
            try {
                const [result] = await db.execute('DELETE FROM comentario_midias WHERE id = ?', [midiaId]);
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Não foi possível apagar o arquivo.' });
            }
            return;
        }

        // DELETE /api/produtos/:id — Excluir produto (Admin)
        if (urlParse.startsWith('/api/produtos/') && req.method === 'DELETE') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            const id = urlParse.split('/').pop();
            try {
                const [result] = await db.execute('DELETE FROM produtos WHERE id = ?', [id]);
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao excluir o produto.' });
            }
            return;
        }

        /* -------------------------------------------------------------------
         * ROTAS DE USUÁRIOS E AUTENTICAÇÃO
         * ------------------------------------------------------------------- */

        if (urlParse === '/api/auth/session' && req.method === 'GET') {
            try {
                const sessao = obterSessaoAdminEnv(req) || await obterSessaoAtual(req);
                if (!sessao) return enviarJson(res, 401, { autenticado: false });
                delete sessao.sessao_id;
                enviarJson(res, 200, { autenticado: true, usuario: sessao });
            } catch (e) {
                logErroSeguro('[auth:login] ERRO stage=session_read', e);
                enviarJson(res, e?.infraestrutura ? 503 : 401, { autenticado: false });
            }
            return;
        }

        if (urlParse === '/api/auth/logout' && req.method === 'POST') {
            try {
                await revogarSessaoAtual(req, res);
                enviarJson(res, 200, { sucesso: true });
            } catch (e) {
                logErroSeguro('[auth:login] ERRO stage=logout', e);
                enviarJson(res, e?.infraestrutura ? 503 : 500, { sucesso: false, erro: 'Nao foi possivel encerrar a sessao agora.' });
            }
            return;
        }

        if (urlParse === '/api/auth/esqueci-senha' && req.method === 'POST') {
            const mensagem = 'Se existir uma conta associada a este e-mail, enviaremos as instrucoes de recuperacao.';
            const chaveLimite = `reset:${clienteIp(req)}`;
            if (!limiteRequisicoes(chaveLimite, 5, 15 * 60 * 1000)) return enviarJson(res, 200, { sucesso: true, mensagem });
            console.log('[auth:reset] solicitacao recebida');
            try {
                if (tabelaAusente(diagnosticoBanco, 'recuperacoes_senha')) {
                    throw erroInfraestrutura('Tabela recuperacoes_senha ausente.');
                }
                const dados = coletarJson(corpo);
                const email = String(dados.email || '').trim().toLowerCase();
                const [rows] = await db.execute('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', [email]);
                if (rows.length) {
                    const usuario = rows[0];
                    console.log(`[auth:reset] usuario localizado id=${usuario.id}`);
                    const token = crypto.randomBytes(32).toString('base64url');
                    const tokenHash = hashToken(token);
                    await db.execute('UPDATE recuperacoes_senha SET utilizado_em = NOW() WHERE usuario_id = ? AND utilizado_em IS NULL', [usuario.id]);
                    await db.execute(
                        'INSERT INTO recuperacoes_senha (usuario_id, token_hash, expira_em) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
                        [usuario.id, tokenHash, RESET_TTL_MINUTES]
                    );
                    console.log(`[auth:reset] token persistido id=${usuario.id}`);
                    console.log(`[auth:reset] enviando email id=${usuario.id}`);
                    await emailService.enviarEmailRecuperacaoSenha({ para: usuario.email, nome: usuario.nome, token });
                    console.log(`[auth:reset] servidor SMTP aceitou mensagem id=${usuario.id}`);
                }
            } catch (e) {
                const stage = e?.infraestrutura || (e?.code && String(e.code).startsWith('ER_')) ? 'database' : 'smtp';
                logErroSeguro(`[auth:reset] falha stage=${stage}`, e);
            }
            enviarJson(res, 200, { sucesso: true, mensagem });
            return;
        }

        if (urlParse === '/api/auth/redefinir-senha' && req.method === 'POST') {
            try {
                if (tabelaAusente(diagnosticoBanco, 'recuperacoes_senha')) {
                    throw erroInfraestrutura('Tabela recuperacoes_senha ausente.');
                }
                const dados = coletarJson(corpo);
                const token = String(dados.token || '');
                const novaSenha = String(dados.novaSenha || dados.senha || '');
                if (!senhaForte(novaSenha)) return enviarJson(res, 400, { erro: 'A nova senha deve ter pelo menos 8 caracteres, com letras e numeros.' });

                const tokenHash = hashToken(token);
                const [rows] = await db.execute(
                    `SELECT r.id, r.usuario_id FROM recuperacoes_senha r
                     WHERE r.token_hash = ? AND r.utilizado_em IS NULL AND r.expira_em > NOW() LIMIT 1`,
                    [tokenHash]
                );
                if (!rows.length) return enviarJson(res, 400, { erro: 'Link invalido ou expirado.' });

                const registro = rows[0];
                await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [criarHashSenha(novaSenha), registro.usuario_id]);
                await db.execute('UPDATE recuperacoes_senha SET utilizado_em = NOW() WHERE id = ?', [registro.id]);
                await revogarSessoesUsuario(registro.usuario_id);
                anexarCookie(res, cookieSessao(req, '', 0));
                enviarJson(res, 200, { sucesso: true, mensagem: 'Senha redefinida com sucesso. Faca login novamente.' });
            } catch (e) {
                logErroSeguro('[auth:reset] falha stage=redefinir', e);
                enviarJson(res, e?.infraestrutura || e?.code ? 503 : 400, { erro: 'Nao foi possivel redefinir a senha.' });
            }
            return;
        }

        if (urlParse === '/api/auth/google' && req.method === 'POST') {
            let stage = 'start';
            try {
                if (tabelaAusente(diagnosticoBanco, 'identidades_usuario')) {
                    throw erroInfraestrutura('Tabela identidades_usuario ausente.');
                }
                const dados = coletarJson(corpo);
                console.log(`[auth:google] credential recebida google_client_id_configured=${Boolean(process.env.GOOGLE_CLIENT_ID)}`);
                stage = 'validate_credential';
                console.log('[auth:google] validando credential');
                const perfil = await validarGoogleCredential(dados.credential);
                console.log('[auth:google] credential valida');
                const email = String(perfil.email || '').toLowerCase();
                const googleId = String(perfil.sub || '');

                stage = 'identity_query';
                console.log('[auth:google] consultando identidade');
                let [identidades] = await db.execute('SELECT usuario_id FROM identidades_usuario WHERE provedor = ? AND provedor_usuario_id = ? LIMIT 1', ['google', googleId]);
                let usuarioId = identidades[0]?.usuario_id;

                if (!usuarioId) {
                    stage = 'user_lookup';
                    console.log('[auth:google] procurando usuario por email');
                    const [usuarios] = await db.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [email]);
                    if (usuarios.length) {
                        usuarioId = usuarios[0].id;
                    } else {
                        stage = 'user_create';
                        const [novo] = await db.execute(
                            'INSERT INTO usuarios (nome, cpf, cep, endereco, telefone, email, senha, foto, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
                            [perfil.name || email, null, null, null, null, email, criarHashSenha(crypto.randomBytes(24).toString('hex')), perfil.picture || 'default.jpg']
                        );
                        usuarioId = novo.insertId;
                    }
                    stage = 'identity_link';
                    console.log('[auth:google] vinculando identidade');
                    await db.execute(
                        'INSERT IGNORE INTO identidades_usuario (usuario_id, provedor, provedor_usuario_id, email_provedor, atualizado_em) VALUES (?, ?, ?, ?, NOW())',
                        [usuarioId, 'google', googleId, email]
                    );
                }

                stage = 'load_user';
                const [rows] = await db.execute('SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin, sessao_versao FROM usuarios WHERE id = ?', [usuarioId]);
                const usuario = rows[0];
                if (!usuario) throw new Error('Usuario Google nao localizado apos vinculacao.');
                stage = 'session_create';
                console.log('[auth:google] criando sessao');
                await criarSessaoUsuario(req, res, usuario);
                console.log(`[auth:google] login concluido id_usuario=${usuario.id}`);
                enviarJson(res, 200, { sucesso: true, usuario, userToken: gerarTokenCliente(usuario.id) });
            } catch (e) {
                logErroSeguro(`[auth:google] falha stage=${stage}`, e);
                const status = stage === 'validate_credential' ? 400 : 503;
                enviarJson(res, status, { erro: status === 400 ? 'Nao foi possivel validar sua conta Google.' : 'Nao foi possivel iniciar sessao com Google agora. Tente novamente em instantes.' });
            }
            return;
        }

        // POST /api/cadastro — Registrar novo usuário
        if (urlParse === '/api/cadastro' && req.method === 'POST') {
            try {
                const dados = coletarJson(corpo);
                const fotoSalva = await imageStorage.salvarImagemBase64(dados.fotoBase64, 'perfil');
                const nomeFoto = fotoSalva || 'default.jpg';

                const [result] = await db.execute(
                    `INSERT INTO usuarios (nome, cpf, cep, endereco, telefone, email, senha, foto, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                    [dados.nome, dados.cpf, dados.cep, dados.endereco, dados.telefone, dados.email, criarHashSenha(dados.senha), nomeFoto]
                );
                enviarJson(res, 201, { sucesso: true, id: result.insertId });
            } catch (e) {
                enviarJson(res, 400, { erro: 'CPF ou e-mail ja cadastrados.' });
            }
            return;
        }

        // POST /api/login e /api/auth/login — Login de cliente e Admin
        if ((urlParse === '/api/login' || urlParse === '/api/auth/login') && req.method === 'POST') {
            const dados = coletarJson(corpo);
            const login = String(dados.email || '').trim().toLowerCase();
            const senha = String(dados.senha || '');
            if (!limiteRequisicoes(`login:${clienteIp(req)}:${login}`, 10, 15 * 60 * 1000)) {
                return enviarJson(res, 429, { sucesso: false, erro: 'Muitas tentativas. Aguarde alguns minutos.' });
            }

            if (ADMIN_USER && ADMIN_SENHA && login === String(ADMIN_USER).toLowerCase() && senha === ADMIN_SENHA) {
                try {
                    const admin = criarSessaoAdminEnv(req, res);
                    console.log('[auth:login] sessao admin_env criada');
                    return enviarJson(res, 200, {
                        sucesso: true,
                        usuario: admin
                    });
                } catch (erroAdminEnv) {
                    logErroSeguro('[auth:login] ERRO stage=admin_env_session', erroAdminEnv);
                    return enviarJson(res, 503, { sucesso: false, erro: 'Nao foi possivel iniciar sessao administrativa agora.' });
                }
            }

            let row;
            try {
                const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ?`, [login]);
                if (rows.length === 0 || !senhaConfere(senha, rows[0].senha)) {
                    console.log('[auth:login] credencial invalida');
                    return enviarJson(res, 401, { sucesso: false, erro: 'Login ou senha incorretos.' });
                }
                row = rows[0];
                console.log(`[auth:login] usuario validado id=${row.id}`);
            } catch (erroBusca) {
                logErroSeguro('[auth:login] ERRO stage=user_lookup', erroBusca);
                return enviarJson(res, 503, { sucesso: false, erro: 'Nao foi possivel validar o login agora. Tente novamente em instantes.' });
            }

            try {
                if (!String(row.senha || '').startsWith('pbkdf2:')) {
                    await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [criarHashSenha(senha), row.id]);
                    console.log(`[auth:login] senha legada migrada id=${row.id}`);
                }
            } catch (erroMigrarSenha) {
                logErroSeguro('[auth:login] ERRO stage=password_upgrade', erroMigrarSenha, { usuario_id: row.id });
                return enviarJson(res, 503, { sucesso: false, erro: 'Nao foi possivel concluir o login agora. Tente novamente em instantes.' });
            }

            try {
                delete row.senha;
                await criarSessaoUsuario(req, res, row);
                console.log(`[auth:login] sessao criada id_usuario=${row.id}`);
                enviarJson(res, 200, {
                    sucesso: true,
                    usuario: row,
                    userToken: gerarTokenCliente(row.id)
                });
            } catch (erroSessao) {
                logErroSeguro('[auth:login] ERRO stage=session_create', erroSessao, { usuario_id: row.id });
                enviarJson(res, 503, { sucesso: false, erro: 'Nao foi possivel iniciar sua sessao. Tente novamente em instantes.' });
            }
            return;
        }

        // GET /api/usuarios — Listar usuários (Admin)
        if (urlParse === '/api/usuarios' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const [rows] = await db.execute(`SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin FROM usuarios ORDER BY id DESC`);
                enviarJson(res, 200, rows || []);
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        // PUT /api/usuarios/:id/perfil — Atualizar próprio perfil do cliente
        if (urlParse.startsWith('/api/usuarios/') && urlParse.endsWith('/perfil') && req.method === 'PUT') {
            const id = urlParse.split('/')[3];
            try {
                if (!(await clienteAutorizado(req, id))) {
                    return enviarJson(res, 403, { erro: 'Não autorizado a editar este perfil.' });
                }
            } catch (erroAuth) {
                logErroSeguro('[auth:login] ERRO stage=cliente_session_read', erroAuth);
                return enviarJson(res, 503, { erro: 'Nao foi possivel validar sua sessao agora.' });
            }
            try {
                const dados = coletarJson(corpo);
                const [result] = await db.execute(
                    'UPDATE usuarios SET email = ?, telefone = ?, endereco = ?, cep = ?, foto = ? WHERE id = ?',
                    [dados.email || '', dados.telefone || '', dados.endereco || '', dados.cep || '', dados.foto || '', id]
                );
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados do usuario invalidos.' });
            }
            return;
        }

        // PUT /api/usuarios/:id — Promover/Rebaixar permissões de Admin
        if (urlParse.startsWith('/api/usuarios/') && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                const [result] = await db.execute('UPDATE usuarios SET is_admin = ? WHERE id = ?', [dados.is_admin ? 1 : 0, id]);
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados do usuario invalidos.' });
            }
            return;
        }

        /* -------------------------------------------------------------------
         * CONFIGURAÇÕES DO SISTEMA
         * ------------------------------------------------------------------- */

        // GET /api/configuracoes-publicas — Dados públicos para o checkout
        if (urlParse === '/api/configuracoes-publicas' && req.method === 'GET') {
            try {
                const [rows] = await db.execute('SELECT public_key, ambiente, taxa_entrega, frete_gratis_acima FROM configuracoes LIMIT 1');
                enviarJson(res, 200, {
                    ...(rows[0] || {}),
                    // TODO ajuste manual: definir GOOGLE_CLIENT_ID no painel da Netlify para ativar login Google.
                    google_client_id: process.env.GOOGLE_CLIENT_ID || ''
                });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao carregar configuracoes públicas.' });
            }
            return;
        }

        // GET /api/configuracoes — Configurações completas (Admin)
        if (urlParse === '/api/configuracoes' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const [rows] = await db.execute('SELECT * FROM configuracoes LIMIT 1');
                enviarJson(res, 200, rows[0] || {});
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao carregar configuracoes.' });
            }
            return;
        }

        // PUT /api/configuracoes — Atualizar configurações (Admin)
        if (urlParse === '/api/configuracoes' && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const dados = coletarJson(corpo);
                await db.execute(
                    `UPDATE configuracoes SET public_key=?, access_token=?, chave_pix=?, nome_recebedor=?, ambiente=?, banco=?, agencia=?, conta=?, taxa_entrega=?, frete_gratis_acima=? WHERE id=1`,
                    [
                        dados.public_key || '',
                        dados.access_token || '',
                        dados.chave_pix || '',
                        dados.nome_recebedor || '',
                        dados.ambiente || 'sandbox',
                        dados.banco || '',
                        dados.agencia || '',
                        dados.conta || '',
                        Number(dados.taxa_entrega || 0),
                        Number(dados.frete_gratis_acima || 0)
                    ]
                );
                enviarJson(res, 200, { sucesso: true });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao salvar configuracoes.' });
            }
            return;
        }

        if (urlParse === '/api/admin/diagnostico' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const database = diagnosticoBanco || await verificarEstruturaBanco();
                const smtp = await emailService.verificarSMTP();
                enviarJson(res, 200, {
                    database,
                    google: {
                        client_id_configurado: Boolean(process.env.GOOGLE_CLIENT_ID)
                    },
                    email: {
                        smtp_configurado: Boolean(process.env.SMTP_HOST),
                        smtp_verificado: Boolean(smtp.verificado),
                        modo_teste: Boolean(smtp.modo_teste),
                        erro: smtp.erro || null
                    },
                    app: {
                        base_url_configurada: Boolean(process.env.APP_BASE_URL)
                    }
                });
            } catch (erroDiagnostico) {
                logErroSeguro('[db:migration] diagnostico falhou', erroDiagnostico);
                enviarJson(res, 503, { erro: 'Nao foi possivel executar diagnostico agora.' });
            }
            return;
        }

        /* -------------------------------------------------------------------
         * PAGAMENTOS E CHECKOUT
         * ------------------------------------------------------------------- */

        // POST /api/checkout — Processar novo pedido com Mercado Pago
        if (urlParse === '/api/checkout' && req.method === 'POST') {
          try {
              const dados = coletarJson(corpo);
              const entregaValidada = validarEnderecoEntrega(dados);
              if (!entregaValidada.ok) return enviarJson(res, 400, { erro: entregaValidada.erro });
              const idsProdutos = (dados.produtos || []).map(p => p.id).filter(Boolean);
              if (idsProdutos.length === 0) {
                  return enviarJson(res, 400, { erro: 'O pedido não contém produtos.' });
              }

              const placeholders = idsProdutos.map(() => '?').join(',');
              const [produtosDoBanco] = await db.execute(`SELECT * FROM produtos WHERE id IN (${placeholders})`, idsProdutos);

              let totalServidor = 0;
              let subtotalServidor = 0;
              let freteServidor = 0;
              let maiorTaxaDeJuros = 0;
              const itensConfirmados = [];

              dados.produtos.forEach(itemCarrinho => {
                  const produtoDB = produtosDoBanco.find(p => p.id === itemCarrinho.id);
                  if (produtoDB) {
                      const quantidade = Math.max(1, Number(itemCarrinho.qtd) || 1);
                      const produtoNormalizado = normalizarProduto(produtoDB);
                      const nomeVariante = normalizarNomeVariantePedido(itemCarrinho.variante);
                      if (estoqueDaVariante(produtoNormalizado, nomeVariante) < quantidade) {
                          throw new Error(`Estoque insuficiente para ${produtoDB.nome}.`);
                      }
                      const precoUnitario = precoEfetivo(produtoDB);
                      const freteUnitario = freteEfetivo(produtoDB);
                      subtotalServidor += precoUnitario * quantidade;
                      freteServidor += freteUnitario * quantidade;
                      totalServidor += (precoUnitario + freteUnitario) * quantidade;
                      itensConfirmados.push({
                          id: produtoDB.id, nome: produtoDB.nome, foto: itemCarrinho.foto,
                          variante: nomeVariante, qtd: quantidade,
                          preco: precoUnitario, frete: freteUnitario
                      });
                      if ((Number(produtoDB.juros_mensal) || 0) > maiorTaxaDeJuros) {
                          maiorTaxaDeJuros = Number(produtoDB.juros_mensal);
                      }
                  }
              });
              if (itensConfirmados.length !== idsProdutos.length) {
                  throw new Error('Um ou mais produtos não estão mais disponíveis. Atualize o carrinho e tente novamente.');
              }

              if (dados.tipoPagamentoMP === 'cartao' && dados.formaPagamento === 'Credito' && maiorTaxaDeJuros > 0 && dados.installments > 1) {
                  totalServidor = totalServidor * Math.pow((1 + maiorTaxaDeJuros / 100), dados.installments);
              }

              dados.total = parseFloat(totalServidor.toFixed(2));
              dados.subtotal = parseFloat(subtotalServidor.toFixed(2));
              dados.valorFrete = parseFloat(freteServidor.toFixed(2));

              const codigoPedido = Math.floor(100000 + Math.random() * 900000);
              const origemAtual = descobrirOrigemPublica(req);
              const ehAmbienteLocal = origemAtual.includes('localhost') || origemAtual.includes('127.0.0.1');
              dados.notificationUrl = dados.notificationUrl || (ehAmbienteLocal ? undefined : `${origemAtual}/api/webhook`);

              mpService.criarPagamento(db, dados, codigoPedido)
                  .then(async (mpResponse) => {
                      const mpId = mpResponse ? String(mpResponse.id) : null;
                      const statusInicial = dados.tipoPagamentoMP === 'pix' ? 'Pendente' : 'Em Processamento';

                      try {
                          const [result] = await db.execute(
                              `INSERT INTO pedidos (codigo_pedido, cliente_id, nome_recebedor, endereco_envio, produtos_json, total, forma_pagamento, status, mercadopago_id, subtotal, valor_frete, origem, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [
                                  codigoPedido, dados.clienteId, entregaValidada.entrega.nome_destinatario, dados.enderecoEnvio,
                                  JSON.stringify(itensConfirmados), dados.total, dados.formaPagamento, statusInicial, mpId,
                                  dados.subtotal, dados.valorFrete,
                                  dados.origem?.origem || null, dados.origem?.utm_source || null, dados.origem?.utm_medium || null,
                                  dados.origem?.utm_campaign || null, dados.origem?.utm_content || null, dados.origem?.utm_term || null,
                                  dados.origem?.gclid || null, dados.origem?.fbclid || null
                              ]
                          );
                          const pedidoId = result.insertId;

                          await db.execute(
                              `INSERT INTO pedido_enderecos (pedido_id, nome_destinatario, cpf, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [
                                  pedidoId, entregaValidada.entrega.nome_destinatario, entregaValidada.entrega.cpf,
                                  entregaValidada.entrega.telefone, entregaValidada.entrega.cep, entregaValidada.entrega.logradouro,
                                  entregaValidada.entrega.numero, entregaValidada.entrega.complemento, entregaValidada.entrega.bairro,
                                  entregaValidada.entrega.cidade, entregaValidada.entrega.estado
                              ]
                          );

                          for (const item of itensConfirmados) {
                              await db.execute(
                                  `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, variante, quantidade, preco_unitario, frete_unitario, total_item)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                  [pedidoId, item.id, item.nome, item.variante, item.qtd, item.preco, item.frete, (Number(item.preco) + Number(item.frete || 0)) * Number(item.qtd)]
                              );
                          }

                          const resposta = { sucesso: true, codigo: codigoPedido, id: pedidoId, status: statusInicial };

                          if (dados.tipoPagamentoMP === 'pix' && mpResponse.point_of_interaction) {
                              resposta.qr_code = mpResponse.point_of_interaction.transaction_data.qr_code;
                              resposta.qr_code_base64 = mpResponse.point_of_interaction.transaction_data.qr_code_base64;
                          }
                          enviarJson(res, 200, resposta);
                      } catch (sqlErr) {
                          console.error('[Checkout] Erro ao gravar pedido no banco:', sqlErr);
                          enviarJson(res, 500, { erro: 'Erro ao gravar o pedido no MySQL.' });
                      }
                  })
                  .catch((error) => {
                      console.error('[Checkout] Erro ao criar pagamento no Mercado Pago:', error.message, error.cause || '');
                      enviarJson(res, 400, { erro: 'Não foi possível processar o pagamento.', detalhes: error.message });
                  });
          } catch (e) {
              console.error('[Checkout] Erro geral:', e);
              enviarJson(res, 400, { erro: e.message || 'Formato de requisição inválido ou erro interno.' });
          }
          return;
        }

        // POST /api/webhook — Retorno do status do Mercado Pago
        if (urlParse === '/api/webhook' && req.method === 'POST') {
            try {
                const queryParams = new URL(req.url, descobrirOrigemPublica(req)).searchParams;
                const paymentId = queryParams.get('data.id') || queryParams.get('id') || coletarJson(corpo)?.data?.id;

                if (paymentId) {
                    mpService.inicializarMercadoPago(db)
                        .then(async (paymentInstance) => {
                            const paymentInfo = await paymentInstance.get({ id: paymentId });
                            const statusMP = paymentInfo.status;

                            let statusSistema = 'Pendente';
                            if (statusMP === 'approved') statusSistema = 'Aprovado (Pronto para Envio)';
                            if (statusMP === 'rejected') statusSistema = 'Cancelado / Recusado';

                            await db.execute(
                                `UPDATE pedidos
                                 SET status = ?,
                                     pago_em = CASE WHEN ? = 'approved' AND pago_em IS NULL THEN NOW() ELSE pago_em END,
                                     cancelado_em = CASE WHEN ? IN ('rejected','cancelled') AND cancelado_em IS NULL THEN NOW() ELSE cancelado_em END
                                 WHERE mercadopago_id = ?`,
                                [statusSistema, statusMP, statusMP, String(paymentId)]
                            );
                            console.log(`[Webhook] Pedido MP #${paymentId} atualizado no MySQL.`);
                        })
                        .catch(err => console.error('[Webhook Error]:', err.message));
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            } catch (e) {
                res.writeHead(200);
                res.end('Erro processado');
            }
            return;
        }

        /* -------------------------------------------------------------------
         * PEDIDOS (PAINEL ADMIN)
         * ------------------------------------------------------------------- */

        // GET /api/pedidos/cliente/:id — Histórico de pedidos do próprio cliente
        if (urlParse.startsWith('/api/pedidos/cliente/') && req.method === 'GET') {
            const clienteId = urlParse.split('/').pop();
            try {
                if (!(await clienteAutorizado(req, clienteId))) {
                    return enviarJson(res, 403, { erro: 'Não autorizado a ver este historico.' });
                }
            } catch (erroAuth) {
                logErroSeguro('[auth:login] ERRO stage=cliente_session_read', erroAuth);
                return enviarJson(res, 503, { erro: 'Nao foi possivel validar sua sessao agora.' });
            }
            try {
                const [rows] = await db.execute(
                    `SELECT id, codigo_pedido, produtos_json, total, forma_pagamento, status FROM pedidos WHERE cliente_id = ? ORDER BY id DESC`,
                    [clienteId]
                );
                const pedidos = (rows || []).map(row => {
                    let produtos = [];
                    try { produtos = JSON.parse(row.produtos_json || '[]'); } catch (e) { produtos = []; }

                    // Agrupa os diversos status internos em duas categorias simples para o cliente
                    const statusFinalizado = String(row.status || '').toLowerCase().includes('finalizado')
                        || String(row.status || '').toLowerCase().includes('entregue');

                    return {
                        id: row.id,
                        codigo_pedido: row.codigo_pedido,
                        produtos,
                        total: row.total,
                        forma_pagamento: row.forma_pagamento,
                        status: row.status,
                        status_simplificado: statusFinalizado ? 'entregue' : 'em_processamento'
                    };
                });
                enviarJson(res, 200, pedidos);
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao carregar historico de pedidos.' });
            }
            return;
        }

        // GET /api/pedidos — Listar pedidos para o admin
        if (urlParse === '/api/pedidos' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                const [rows] = await db.execute(
                    `SELECT pedidos.*,
                            usuarios.nome as cliente_nome, usuarios.telefone, usuarios.cpf, usuarios.email, usuarios.cep, usuarios.endereco,
                            pe.nome_destinatario AS entrega_nome, pe.cpf AS entrega_cpf, pe.telefone AS entrega_telefone,
                            pe.cep AS entrega_cep, pe.logradouro AS entrega_logradouro, pe.numero AS entrega_numero,
                            pe.complemento AS entrega_complemento, pe.bairro AS entrega_bairro,
                            pe.cidade AS entrega_cidade, pe.estado AS entrega_estado
                     FROM pedidos
                     LEFT JOIN usuarios ON pedidos.cliente_id = usuarios.id
                     LEFT JOIN pedido_enderecos pe ON pe.pedido_id = pedidos.id
                     ORDER BY pedidos.id DESC`
                );
                const pedidos = (rows || []).map(row => {
                    let produtos = [];
                    try { produtos = JSON.parse(row.produtos_json || '[]'); } catch (e) { produtos = []; }
                    return { ...row, produtos };
                });
                enviarJson(res, 200, pedidos);
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        if (urlParse === '/api/admin/analytics/resumo' && req.method === 'GET') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            try {
                if (tabelaAusente(diagnosticoBanco, 'pedido_itens') || colunaAusente(diagnosticoBanco, 'pedidos_criado_em')) {
                    console.error('[analytics] estrutura ausente', {
                        pedido_itens: diagnosticoBanco?.tabelas?.pedido_itens,
                        pedidos_criado_em: diagnosticoBanco?.colunas?.pedidos_criado_em
                    });
                    return enviarJson(res, 503, { erro: 'Analise indisponivel: estrutura do banco ainda nao foi aplicada.' });
                }
                const params = new URL(req.url, descobrirOrigemPublica(req)).searchParams;
                const hoje = new Date();
                const dataFim = params.get('data_fim') || params.get('fim') || hoje.toISOString().slice(0, 10);
                const dataInicio = params.get('data_inicio') || params.get('inicio') || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
                    return enviarJson(res, 400, { erro: 'Periodo invalido.' });
                }

                const inicio = `${dataInicio} 00:00:00`;
                const fimExclusivoDate = new Date(`${dataFim}T00:00:00`);
                fimExclusivoDate.setDate(fimExclusivoDate.getDate() + 1);
                const fim = `${fimExclusivoDate.toISOString().slice(0, 10)} 00:00:00`;
                console.log(`[analytics] periodo inicio=${dataInicio} fim=${fimExclusivoDate.toISOString().slice(0, 10)}`);
                const filtro = [inicio, fim];

                const [resumoRows] = await db.execute(
                    `SELECT
                        COALESCE(SUM(CASE WHEN status LIKE 'Aprovado%' OR status LIKE 'Finalizado%' THEN total ELSE 0 END),0) faturamento_aprovado,
                        SUM(CASE WHEN status LIKE 'Aprovado%' OR status LIKE 'Finalizado%' THEN 1 ELSE 0 END) pedidos_pagos,
                        SUM(CASE WHEN status LIKE 'Pendente%' THEN 1 ELSE 0 END) pedidos_pendentes,
                        SUM(CASE WHEN status LIKE 'Cancelado%' OR status LIKE '%Recusado%' THEN 1 ELSE 0 END) pedidos_cancelados,
                        COUNT(*) total_pedidos,
                        COUNT(DISTINCT cliente_id) clientes_unicos
                     FROM pedidos WHERE criado_em >= ? AND criado_em < ?`,
                    filtro
                );
                const resumo = resumoRows[0] || {};

                const [unidadesRows] = await db.execute(
                    `SELECT COALESCE(SUM(quantidade),0) unidades_vendidas FROM pedido_itens pi
                     INNER JOIN pedidos p ON p.id = pi.pedido_id
                     WHERE p.criado_em >= ? AND p.criado_em < ? AND (p.status LIKE 'Aprovado%' OR p.status LIKE 'Finalizado%')`,
                    filtro
                );

                const [porDia] = await db.execute(
                    `SELECT DATE(criado_em) dia, COALESCE(SUM(total),0) faturamento, COUNT(*) pedidos
                     FROM pedidos WHERE criado_em >= ? AND criado_em < ? AND (status LIKE 'Aprovado%' OR status LIKE 'Finalizado%')
                     GROUP BY DATE(criado_em) ORDER BY dia`,
                    filtro
                );

                const [porStatus] = await db.execute(
                    `SELECT status, COUNT(*) total FROM pedidos WHERE criado_em >= ? AND criado_em < ? GROUP BY status ORDER BY total DESC`,
                    filtro
                );

                const [produtos] = await db.execute(
                    `SELECT pi.nome_produto nome, COALESCE(SUM(pi.quantidade),0) quantidade, COALESCE(SUM(pi.total_item),0) faturamento
                     FROM pedido_itens pi INNER JOIN pedidos p ON p.id = pi.pedido_id
                     WHERE p.criado_em >= ? AND p.criado_em < ? AND (p.status LIKE 'Aprovado%' OR p.status LIKE 'Finalizado%')
                     GROUP BY pi.nome_produto ORDER BY quantidade DESC LIMIT 10`,
                    filtro
                );

                const [pagamentos] = await db.execute(
                    `SELECT forma_pagamento nome, COUNT(*) pedidos, COALESCE(SUM(total),0) faturamento
                     FROM pedidos WHERE criado_em >= ? AND criado_em < ?
                     GROUP BY forma_pagamento ORDER BY pedidos DESC`,
                    filtro
                );

                const [origens] = await db.execute(
                    `SELECT COALESCE(utm_source, origem, 'direto') origem, COUNT(*) pedidos, COALESCE(SUM(total),0) faturamento
                     FROM pedidos WHERE criado_em >= ? AND criado_em < ?
                     GROUP BY COALESCE(utm_source, origem, 'direto') ORDER BY pedidos DESC LIMIT 10`,
                    filtro
                );

                const [clientesPeriodo] = await db.execute(
                    `SELECT cliente_id, COUNT(*) pedidos
                     FROM pedidos
                     WHERE criado_em >= ? AND criado_em < ? AND cliente_id IS NOT NULL
                     GROUP BY cliente_id`,
                    filtro
                );
                const clientes_novos = clientesPeriodo.filter(c => Number(c.pedidos || 0) === 1).length;
                const clientes_recorrentes = clientesPeriodo.filter(c => Number(c.pedidos || 0) > 1).length;

                const pagos = Number(resumo.pedidos_pagos || 0);
                console.log(`[analytics] resumo pedidos=${Number(resumo.total_pedidos || 0)} faturamento=${Number(resumo.faturamento_aprovado || 0)}`);
                enviarJson(res, 200, {
                    periodo: { inicio: dataInicio, fim: dataFim },
                    resumo: {
                        faturamento_aprovado: Number(resumo.faturamento_aprovado || 0),
                        pedidos_pagos: pagos,
                        ticket_medio: pagos ? Number(resumo.faturamento_aprovado || 0) / pagos : 0,
                        unidades_vendidas: Number(unidadesRows[0]?.unidades_vendidas || 0),
                        pedidos_pendentes: Number(resumo.pedidos_pendentes || 0),
                        pedidos_cancelados: Number(resumo.pedidos_cancelados || 0),
                        taxa_aprovacao: Number(resumo.total_pedidos || 0) ? pagos / Number(resumo.total_pedidos) : 0,
                        clientes_unicos: Number(resumo.clientes_unicos || 0),
                        clientes_novos,
                        clientes_recorrentes,
                        produto_mais_vendido: produtos[0]?.nome || null,
                        forma_pagamento_mais_usada: pagamentos[0]?.nome || null
                    },
                    porDia, porStatus, produtos, pagamentos, origens
                });
            } catch (err) {
                logErroSeguro('[analytics] erro ao carregar resumo', err);
                enviarJson(res, 503, { erro: 'Erro ao carregar analytics. Verifique os logs do servidor.' });
            }
            return;
        }

        // GET /api/pedidos/status/:codigo — Verificar status de um pedido (cliente)
        if (urlParse.startsWith('/api/pedidos/status/') && req.method === 'GET') {
            const codigo = urlParse.split('/').pop();
            try {
                const [rows] = await db.execute('SELECT status FROM pedidos WHERE codigo_pedido = ?', [codigo]);
                if (rows.length === 0) {
                    return enviarJson(res, 404, { erro: 'Pedido não encontrado.' });
                }
                const statusAtual = rows[0].status;
                const pago = statusAtual.toLowerCase().includes('aprovado');
                enviarJson(res, 200, { sucesso: true, status: statusAtual, pago: pago });
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao consultar o status do pedido.' });
            }
            return;
        }

        // PUT /api/pedidos/finalizar/:id — Marcar pedido como entregue/finalizado
        if (urlParse.startsWith('/api/pedidos/finalizar/') && req.method === 'PUT') {
            if (!(await exigirAcessoAdmin(req, res))) return;
            const id = urlParse.split('/').pop();
            try {
                const [pedido] = await db.execute('SELECT status, produtos_json FROM pedidos WHERE id=?', [id]);
                if (!pedido.length) return enviarJson(res, 404, { sucesso: false });
                const jaEntregue = String(pedido[0].status || '').toLowerCase().includes('finalizado') || String(pedido[0].status || '').toLowerCase().includes('entregue');
                const [result] = await db.execute(`UPDATE pedidos SET status = 'Finalizado (Entregue)', entregue_em = COALESCE(entregue_em, NOW()) WHERE id = ?`, [id]);
                if (!jaEntregue) {
                    let itens = []; try { itens = JSON.parse(pedido[0].produtos_json || '[]'); } catch (_) {}
                    for (const item of itens) {
                        const quantidade = Math.max(1, Number(item.qtd || 1));
                        const baixou = await ajustarEstoque(item.id, normalizarNomeVariantePedido(item.variante), -quantidade);
                        if (!baixou) {
                            return enviarJson(res, 409, { sucesso: false, erro: 'Estoque insuficiente para concluir este pedido.' });
                        }
                        await db.execute('UPDATE produtos SET vendas_confirmadas = vendas_confirmadas + ? WHERE id = ?', [quantidade, item.id]);
                    }
                }
                enviarJson(res, 200, { sucesso: result.affectedRows > 0 });
            } catch (err) {
                enviarJson(res, 500, { sucesso: false });
            }
            return;
        }

        /* -------------------------------------------------------------------
         * FALLBACK: ARQUIVOS ESTÁTICOS
         * ------------------------------------------------------------------- */
        if (req.method === 'GET') {
            servirArquivo(req, res, urlParse);
            return;
        }

        enviarJson(res, 404, { erro: 'Rota nao encontrada.' });
    });
}

module.exports = { handleRequest };

if (process.env.NODE_ENV === 'test') {
    const executarDbOriginal = db.execute;
    module.exports.__test = {
        tabelaAusente,
        colunaAusente,
        criarSessaoUsuario,
        criarTokenSessaoAdmin,
        tokenSessaoAdminValido,
        possuiAcessoAdmin,
        configurarBancoPronto(diagnostico) {
            diagnosticoBanco = diagnostico;
            promessaBancoPronto = Promise.resolve(diagnostico);
        },
        configurarExecutarDb(executar) {
            db.execute = executar;
        },
        configurarGoogleOAuthClient(cliente) {
            googleOAuthClient = cliente;
        },
        restaurar() {
            db.execute = executarDbOriginal;
            promessaBancoPronto = null;
            diagnosticoBanco = null;
            googleOAuthClient = null;
            RATE_LIMITS.clear();
        }
    };
}


