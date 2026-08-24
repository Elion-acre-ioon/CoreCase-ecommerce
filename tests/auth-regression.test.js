const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const PDFDocument = require('pdfkit');
const serverless = require('serverless-http');
const imageStorage = require('../imageStorage');

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'admin-env-test';
process.env.ADMIN_SENHA = crypto.randomBytes(18).toString('base64url');
process.env.ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'google-client-test';

const { handleRequest, __test } = require('../api');
const { handler: netlifyHandler } = require('../netlify/functions/api');

function hashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(senha, salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}

function extrairCookie(resposta, nome) {
    const setCookie = resposta.headers.get('set-cookie') || '';
    const encontrado = setCookie.match(new RegExp(`(?:^|,\\s*)${nome}=([^;,]*)`));
    return encontrado ? `${nome}=${encontrado[1]}` : '';
}

function criarBancoMock() {
    const usuarios = [
        { id: 1, nome: 'Cliente', email: 'cliente@teste.local', senha: hashSenha('Senha123'), is_admin: 0, ativo: 1, sessao_versao: 0, theme: 'light' },
        { id: 2, nome: 'Google', email: 'google@teste.local', senha: hashSenha('Google123'), is_admin: 0, ativo: 1, sessao_versao: 0, theme: 'light' },
        { id: 3, nome: 'Admin Banco', email: 'admin-banco@teste.local', senha: hashSenha('Admin123'), is_admin: 1, ativo: 1, sessao_versao: 0, theme: 'light' }
    ];
    const sessoes = [];
    const comentarios = [];
    const categorias = [
        { id: 10, nome: 'Fones', slug: 'fones', ativo: 1 },
        { id: 11, nome: 'Cabos', slug: 'cabos', ativo: 1 }
    ];
    const configuracoes = {
        id: 1,
        home_vitrine_destaques_json: '[]',
        home_vitrine_categorias_json: '[]',
        home_vitrine_rodape_json: null,
        home_vitrine_produtos_json: '[]',
        home_vitrine_intervalo_ms: 7000,
        recibo_config_json: null
    };
    const produtos = [
        {
            id: 3,
            nome: 'Produto Tres',
            preco: 30,
            preco_promocional: 0,
            promocao_ativa: 0,
            frete: 10,
            frete_promocional: 0,
            frete_promocao_ativa: 0,
            estoque: 5,
            vendas_iniciais: 0,
            vendas_confirmadas: 0,
            foto: '["https://res.cloudinary.com/demo/image/upload/produto-3.jpg"]',
            max_parcelas: 12,
            juros_mensal: 0,
            variantes: '[]',
            produto_tags: '[]',
            categoria_id: null,
            categoria_nome: null,
            categoria_slug: null,
            descricao: 'Descricao tres',
            sobre: 'Sobre tres',
            informacoes: 'Info tres'
        },
        {
            id: 4,
            nome: 'Produto Quatro',
            preco: 40,
            preco_promocional: 35,
            promocao_ativa: 1,
            frete: 12,
            frete_promocional: 0,
            frete_promocao_ativa: 0,
            estoque: 7,
            vendas_iniciais: 1,
            vendas_confirmadas: 2,
            foto: '["https://res.cloudinary.com/demo/image/upload/produto-4.jpg"]',
            max_parcelas: 12,
            juros_mensal: 0,
            variantes: '[{"nome":"Padrao","imagem":null,"estoque":7}]',
            produto_tags: '["novo"]',
            categoria_id: null,
            categoria_nome: null,
            categoria_slug: null,
            descricao: 'Descricao quatro',
            sobre: 'Sobre quatro',
            informacoes: 'Info quatro'
        }
    ];
    const pedidos = [{
        id: 1042,
        codigo_pedido: 'CC-1042',
        cliente_id: 1,
        cliente_nome: 'Cliente',
        telefone: '11999999999',
        cpf: '12345678900',
        email: 'cliente@teste.local',
        status: 'Finalizado',
        total: 159.8,
        subtotal: 149.8,
        valor_frete: 10,
        desconto: 0,
        forma_pagamento: 'PIX',
        mercadopago_id: 'MP-1042',
        criado_em: '2026-08-23 12:00:00',
        produtos_json: JSON.stringify([
            { id: 3, nome: 'Produto Tres', variante: 'Padrão', qtd: 2, preco: 49.9 },
            { id: 4, nome: 'Produto Quatro', variante: 'Preta', qtd: 1, preco: 60 }
        ]),
        reembolso_status: 'solicitado',
        reembolso_solicitado_em: '2026-08-24 14:35:00'
    }];
    const idempotencias = [];
    let consultas = 0;

    async function execute(sql, parametros = []) {
        consultas++;
        const consulta = String(sql).replace(/\s+/g, ' ').trim();

        if (consulta.startsWith('INSERT INTO produto_idempotencia (chave, payload_hash)')) {
            if (idempotencias.some(item => item.chave === parametros[0])) {
                const erro = new Error('duplicate'); erro.code = 'ER_DUP_ENTRY'; throw erro;
            }
            idempotencias.push({ chave: parametros[0], payload_hash: parametros[1], produto_id: null });
            return [{ affectedRows: 1 }, []];
        }
        if (consulta.startsWith('SELECT produto_id, payload_hash FROM produto_idempotencia WHERE chave = ?')) {
            const item = idempotencias.find(op => op.chave === parametros[0]);
            return [item ? [{ ...item }] : [], []];
        }
        if (consulta.startsWith('UPDATE produto_idempotencia SET produto_id = ? WHERE chave = ?')) {
            const item = idempotencias.find(op => op.chave === parametros[1]);
            if (item) item.produto_id = Number(parametros[0]);
            return [{ affectedRows: item ? 1 : 0 }, []];
        }
        if (consulta.startsWith('DELETE FROM produto_idempotencia WHERE chave = ?')) {
            const indice = idempotencias.findIndex(op => op.chave === parametros[0] && op.produto_id === null);
            if (indice >= 0) idempotencias.splice(indice, 1);
            return [{ affectedRows: indice >= 0 ? 1 : 0 }, []];
        }
        if (consulta.startsWith('INSERT INTO produtos (nome, preco,')) {
            const id = Math.max(...produtos.map(item => item.id)) + 1;
            produtos.push({ id, nome: parametros[0], preco: parametros[1], preco_promocional: parametros[2], promocao_ativa: parametros[3], frete: parametros[4], frete_promocional: parametros[5], frete_promocao_ativa: parametros[6], estoque: parametros[7], vendas_iniciais: parametros[8], vendas_confirmadas: 0, descricao: parametros[9], sobre: parametros[10], informacoes: parametros[11], foto: parametros[12], max_parcelas: parametros[13], juros_mensal: parametros[14], variantes: parametros[15], produto_tags: parametros[16], categoria_id: parametros[17] });
            return [{ insertId: id, affectedRows: 1 }, []];
        }

        if (consulta.startsWith('SELECT * FROM usuarios WHERE email = ?')) {
            const usuario = usuarios.find(item => item.email === parametros[0]);
            return [usuario ? [{ ...usuario }] : [], []];
        }
        if (consulta.startsWith('UPDATE usuarios SET senha = ? WHERE id = ?')) {
            const usuario = usuarios.find(item => item.id === Number(parametros[1]));
            if (usuario) usuario.senha = parametros[0];
            return [{ affectedRows: usuario ? 1 : 0 }, []];
        }
        if (consulta.startsWith('INSERT INTO sessoes')) {
            sessoes.push({
                id: sessoes.length + 1,
                usuario_id: Number(parametros[0]),
                token_hash: parametros[1],
                sessao_versao: Number(parametros[2]),
                expira_em: parametros[3],
                revogado_em: null
            });
            return [{ insertId: sessoes.length }, []];
        }
        if (consulta.includes('FROM sessoes s') && consulta.includes('INNER JOIN usuarios u')) {
            const sessao = sessoes.find(item => item.token_hash === parametros[0]);
            const usuario = sessao && usuarios.find(item => item.id === sessao.usuario_id);
            if (!sessao || !usuario) return [[], []];
            return [[{
                sessao_id: sessao.id,
                expira_em: sessao.expira_em,
                revogado_em: sessao.revogado_em,
                sessao_versao: sessao.sessao_versao,
                usuario_sessao_versao: usuario.sessao_versao,
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                is_admin: usuario.is_admin,
                ativo: usuario.ativo,
                theme: usuario.theme,
                cpf: null,
                cep: null,
                endereco: null,
                telefone: null,
                foto: null
            }], []];
        }
        if (consulta.startsWith('UPDATE sessoes SET ultimo_uso_em')) return [{ affectedRows: 1 }, []];
        if (consulta.startsWith('UPDATE sessoes SET revogado_em = NOW() WHERE token_hash = ?')) {
            const sessao = sessoes.find(item => item.token_hash === parametros[0]);
            if (sessao) sessao.revogado_em = new Date();
            return [{ affectedRows: sessao ? 1 : 0 }, []];
        }
        if (consulta.startsWith('SELECT usuario_id FROM identidades_usuario')) {
            return [[{ usuario_id: 2 }], []];
        }
        if (consulta.startsWith('SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin, sessao_versao, theme FROM usuarios WHERE id = ?')) {
            const usuario = usuarios.find(item => item.id === Number(parametros[0]));
            return [usuario ? [{ ...usuario }] : [], []];
        }
        if (consulta.startsWith('UPDATE usuarios SET nome = ?, email = ?, telefone = ?, endereco = ?, cep = ?, foto = ?, theme = ?')) {
            const usuario = usuarios.find(item => item.id === Number(parametros[7]) && item.ativo === 1);
            if (usuario) {
                [usuario.nome, usuario.email, usuario.telefone, usuario.endereco, usuario.cep, usuario.foto, usuario.theme] = parametros.slice(0, 7);
            }
            return [{ affectedRows: usuario ? 1 : 0 }, []];
        }
        if (consulta.startsWith('SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin, ativo FROM usuarios ORDER BY id DESC')) {
            return [usuarios.map(({ senha, sessao_versao, ...usuario }) => ({ ...usuario })), []];
        }
        if (consulta.startsWith('INSERT INTO comentarios_produto')) {
            comentarios.push({
                id: comentarios.length + 1,
                produto_id: Number(parametros[0]),
                usuario_id: parametros[1] === null ? null : Number(parametros[1]),
                nome_manual: parametros[2],
                foto_manual: parametros[3],
                nota: Number(parametros[4]),
                texto: parametros[5]
            });
            return [{ insertId: comentarios.length }, []];
        }
        if (consulta.startsWith('SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE p.id = ?')) {
            const produto = produtos.find(item => item.id === Number(parametros[0]));
            return [produto ? [{ ...produto }] : [], []];
        }
        if (consulta.startsWith('SELECT id, home_vitrine_destaques_json, home_vitrine_categorias_json, home_vitrine_rodape_json,')) {
            return [[{ ...configuracoes }], []];
        }
        if (consulta === 'SELECT recibo_config_json FROM configuracoes ORDER BY id ASC LIMIT 1') {
            return [[{ recibo_config_json: configuracoes.recibo_config_json }], []];
        }
        if (consulta.startsWith('UPDATE configuracoes SET recibo_config_json = ?')) {
            configuracoes.recibo_config_json = parametros[0];
            return [{ affectedRows: 1 }, []];
        }
        if (consulta.startsWith('SELECT pedidos.*, usuarios.nome as cliente_nome')) {
            return [pedidos.map(item => ({ ...item })), []];
        }
        if (consulta.startsWith('SELECT p.*, u.nome cliente_nome')) {
            return [pedidos.map(item => ({ ...item, cliente_cpf:item.cpf, cliente_email:item.email, cliente_telefone:item.telefone })), []];
        }
        if (consulta.startsWith('SELECT COALESCE(SUM(CASE WHEN status LIKE')) {
            return [[{ faturamento_aprovado:159.8, pedidos_pagos:1, pedidos_pendentes:0, pedidos_cancelados:0, total_pedidos:1, clientes_unicos:1 }], []];
        }
        if (consulta.startsWith('SELECT COALESCE(SUM(quantidade),0) unidades_vendidas')) return [[{ unidades_vendidas:3 }], []];
        if (consulta.startsWith('SELECT DATE(criado_em) dia')) return [[{ dia:'2026-08-23', faturamento:159.8, pedidos:1 }], []];
        if (consulta.startsWith('SELECT DATE(sr.solicitado_em) dia')) return [[{ dia:'2026-08-24', solicitacoes:1 }], []];
        if (consulta.startsWith('SELECT status, COUNT(*) total')) return [[{ status:'Finalizado', total:1 }], []];
        if (consulta.startsWith('SELECT pi.nome_produto nome')) return [[{ nome:'Produto Tres', quantidade:2, faturamento:99.8 }, { nome:'Produto Quatro', quantidade:1, faturamento:60 }], []];
        if (consulta.startsWith('SELECT forma_pagamento nome')) return [[{ nome:'PIX', pedidos:1, faturamento:159.8 }], []];
        if (consulta.startsWith("SELECT COALESCE(utm_source, origem, 'direto') origem")) return [[{ origem:'direto', pedidos:1, faturamento:159.8 }], []];
        if (consulta.startsWith('SELECT cliente_id, COUNT(*) pedidos')) return [[{ cliente_id:1, pedidos:1 }], []];
        if (consulta.startsWith('SELECT id FROM produtos WHERE id IN (')) {
            const ids = new Set(parametros.map(Number));
            return [produtos.filter(item => ids.has(item.id)).map(item => ({ id: item.id })), []];
        }
        if (consulta.startsWith('SELECT id FROM categorias WHERE id IN (')) {
            const ids = new Set(parametros.map(Number));
            return [categorias.filter(item => ids.has(item.id)).map(item => ({ id: item.id })), []];
        }
        if (consulta.startsWith('SELECT id, nome FROM produtos WHERE id IN (')) {
            const ids = new Set(parametros.map(Number));
            return [produtos.filter(item => ids.has(item.id)).map(item => ({ id: item.id, nome: item.nome })), []];
        }
        if (consulta.startsWith('SELECT id, nome, slug FROM categorias WHERE ativo = 1 AND id IN (')) {
            const ids = new Set(parametros.map(Number));
            return [categorias.filter(item => item.ativo === 1 && ids.has(item.id)).map(item => ({ id: item.id, nome: item.nome, slug: item.slug })), []];
        }
        if (consulta.startsWith('UPDATE configuracoes SET home_vitrine_')) {
            const coluna = consulta.match(/SET (home_vitrine_[a-z_]+) = \?/i)?.[1];
            if (!coluna || Number(parametros[1]) !== configuracoes.id) return [{ affectedRows: 0 }, []];
            configuracoes[coluna] = parametros[0];
            return [{ affectedRows: 1 }, []];
        }
        throw new Error(`SQL inesperado no teste: ${consulta}`);
    }

    return { execute, usuarios, sessoes, comentarios, produtos, pedidos, categorias, configuracoes, idempotencias, totalConsultas: () => consultas };
}

test('regressoes de autenticacao', async t => {
    const banco = criarBancoMock();
    __test.configurarBancoPronto({ conectado: true, tabelas: {}, colunas: {}, schema_version: 3 });
    __test.configurarExecutarDb(banco.execute);
    __test.configurarTransacaoProduto(callback => callback({ execute: banco.execute }));
    __test.configurarGoogleOAuthClient({
        async verifyIdToken() {
            return { getPayload: () => ({ sub: 'google-2', email: 'google@teste.local', email_verified: true, name: 'Google' }) };
        }
    });

    const servidor = http.createServer(handleRequest);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
    const requisicao = (caminho, opcoes = {}) => fetch(`${baseUrl}${caminho}`, opcoes);
    const salvarImagemOriginal = imageStorage.salvarImagemBase64;
    const uploadsVitrine = [];
    imageStorage.salvarImagemBase64 = async (base64, prefixo) => {
        uploadsVitrine.push({ base64, prefixo });
        return `https://res.cloudinary.com/test/image/upload/${prefixo}-${uploadsVitrine.length}.jpg`;
    };

    await t.test('fast path desconhecido nao significa tabela ausente', () => {
        assert.equal(__test.tabelaAusente({ tabelas: {} }, 'sessoes'), false);
        assert.equal(__test.colunaAusente({ colunas: {} }, 'usuarios_sessao_versao'), false);
    });

    await t.test('false explicito significa estrutura realmente ausente', async () => {
        assert.equal(__test.tabelaAusente({ tabelas: { sessoes: false } }, 'sessoes'), true);
        __test.configurarBancoPronto({ conectado: true, tabelas: { sessoes: false }, colunas: {} });
        await assert.rejects(
            __test.criarSessaoUsuario({ headers: {} }, { getHeader() {}, setHeader() {} }, { id: 1 }),
            erro => erro?.infraestrutura === true && erro.message === 'Tabela sessoes ausente.'
        );
        __test.configurarBancoPronto({ conectado: true, tabelas: {}, colunas: {}, schema_version: 3 });
    });

    let cookieCliente;
    await t.test('login normal cria cc_session no fast path', async () => {
        const resposta = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'cliente@teste.local', senha: 'Senha123' })
        });
        assert.equal(resposta.status, 200);
        const dadosLogin = await resposta.clone().json();
        assert.equal(dadosLogin.usuario.theme, 'light');
        cookieCliente = extrairCookie(resposta, 'cc_session');
        assert.match(cookieCliente, /^cc_session=.+/);
        assert.equal(banco.sessoes.length, 1);

        const sessao = await requisicao('/api/auth/session', { headers: { Cookie: cookieCliente } });
        assert.equal(sessao.status, 200);
        const dadosSessao = await sessao.json();
        assert.equal(dadosSessao.usuario.id, 1);
        assert.equal(dadosSessao.usuario.theme, 'light');
    });

    await t.test('senha errada retorna 401 sem cookie', async () => {
        const resposta = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'cliente@teste.local', senha: 'incorreta' })
        });
        assert.equal(resposta.status, 401);
        assert.equal(extrairCookie(resposta, 'cc_session'), '');
    });

    await t.test('Google preserva fluxo e cria cc_session', async () => {
        const resposta = await requisicao('/api/auth/google', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: 'credential-mock' })
        });
        assert.equal(resposta.status, 200);
        assert.equal((await resposta.clone().json()).usuario.theme, 'light');
        assert.match(extrairCookie(resposta, 'cc_session'), /^cc_session=.+/);
    });

    await t.test('preferencia de tema aceita somente light ou dark e pertence ao cliente', async () => {
        const perfil = {
            nome: 'Cliente Tema', email: 'cliente@teste.local', telefone: '11999999999',
            endereco: 'Rua Teste, 10', cep: '01001000', foto: '', theme: 'dark'
        };
        const salva = await requisicao('/api/usuarios/1/perfil', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookieCliente }, body: JSON.stringify(perfil)
        });
        assert.equal(salva.status, 200);
        assert.equal((await salva.json()).theme, 'dark');
        assert.equal(banco.usuarios[0].theme, 'dark');

        const sessao = await requisicao('/api/auth/session', { headers: { Cookie: cookieCliente } });
        assert.equal((await sessao.json()).usuario.theme, 'dark');

        const invalido = await requisicao('/api/usuarios/1/perfil', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookieCliente }, body: JSON.stringify({ ...perfil, theme: 'system' })
        });
        assert.equal(invalido.status, 400);
        assert.equal(banco.usuarios[0].theme, 'dark');

        const outraConta = await requisicao('/api/usuarios/2/perfil', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookieCliente }, body: JSON.stringify({ ...perfil, theme: 'light' })
        });
        assert.equal(outraConta.status, 403);
    });

    await t.test('tema publico tem bootstrap anti-flash, cache isolado e nao alcanca o Admin', () => {
        const raiz = path.join(__dirname, '..', 'public');
        const paginas = ['index.html', 'loja.html', 'produto.html', 'cart.html', 'checkout.html', 'historico.html', 'cliente-config.html', 'login.html'];
        for (const pagina of paginas) {
            const html = fs.readFileSync(path.join(raiz, pagina), 'utf8');
            assert.ok(html.indexOf('/tema.js') < html.indexOf('stylesheet'), `${pagina} carrega o tema antes do CSS`);
            assert.match(html, /tema\.css/);
        }
        for (const pagina of fs.readdirSync(raiz).filter(nome => /^admin.*\.html$/.test(nome))) {
            const html = fs.readFileSync(path.join(raiz, pagina), 'utf8');
            assert.doesNotMatch(html, /tema\.(?:js|css)/);
        }
        const bootstrap = fs.readFileSync(path.join(raiz, 'tema.js'), 'utf8');
        const temaCss = fs.readFileSync(path.join(raiz, 'tema.css'), 'utf8');
        const usuario = fs.readFileSync(path.join(raiz, 'usuario.js'), 'utf8');
        const configuracao = fs.readFileSync(path.join(raiz, 'cliente-config.html'), 'utf8');
        assert.match(bootstrap, /corecase_theme_user/);
        assert.match(bootstrap, /donoCache === String\(usuario\.id\)/);
        assert.doesNotMatch(bootstrap, /fetch\s*\(/);
        assert.match(usuario, /CoreCaseTema\.limpar\(\)/);
        assert.match(usuario, /\/api\/auth\/session/);
        assert.match(configuracao, /name="cfgTheme" value="light"/);
        assert.match(configuracao, /name="cfgTheme" value="dark"/);
        assert.match(temaCss, /html\[data-theme="dark"\]/);
        assert.doesNotMatch(temaCss, /filter\s*:\s*(?:invert|brightness)/i);
    });

    await t.test('bootstrap do tema elimina vazamento entre visitante e contas diferentes', () => {
        const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'tema.js'), 'utf8');
        function executarTema(valores) {
            const dados = new Map(Object.entries(valores));
            const classList = { add() {}, remove() {} };
            const sandbox = {
                localStorage: {
                    getItem: chave => dados.has(chave) ? dados.get(chave) : null,
                    setItem: (chave, valor) => dados.set(chave, String(valor)),
                    removeItem: chave => dados.delete(chave)
                },
                document: { documentElement: { dataset: {}, classList } },
                window: { setTimeout: funcao => funcao() }
            };
            sandbox.window.window = sandbox.window;
            vm.runInNewContext(codigo, sandbox);
            return { dados, raiz: sandbox.document.documentElement, api: sandbox.window.CoreCaseTema };
        }

        const visitante = executarTema({ corecase_theme: 'dark', corecase_theme_user: '1' });
        assert.equal(visitante.raiz.dataset.theme, 'light');
        assert.equal(visitante.dados.has('corecase_theme'), false);

        const contaDark = executarTema({ usuario_logado: JSON.stringify({ id: 1, theme: 'dark' }), corecase_theme: 'dark', corecase_theme_user: '1' });
        assert.equal(contaDark.raiz.dataset.theme, 'dark');

        const outraConta = executarTema({ usuario_logado: JSON.stringify({ id: 2, theme: 'light' }), corecase_theme: 'dark', corecase_theme_user: '1' });
        assert.equal(outraConta.raiz.dataset.theme, 'light');
        outraConta.api.confirmarUsuario({ id: 2, theme: 'dark' });
        assert.equal(outraConta.dados.get('corecase_theme_user'), '2');
        assert.equal(outraConta.raiz.dataset.theme, 'dark');
        outraConta.api.limpar();
        assert.equal(outraConta.raiz.dataset.theme, 'light');
        assert.equal(outraConta.dados.has('corecase_theme'), false);
    });

    let cookieAdminEnv;
    await t.test('admin por ambiente nao depende de usuario MySQL', async () => {
        const antes = banco.totalConsultas();
        const resposta = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: process.env.ADMIN_USER, senha: process.env.ADMIN_SENHA })
        });
        assert.equal(resposta.status, 200);
        const dados = await resposta.json();
        assert.equal(dados.usuario.is_admin, 1);
        assert.equal(Object.hasOwn(dados, 'adminToken'), false);
        cookieAdminEnv = extrairCookie(resposta, 'cc_admin_session');
        assert.match(cookieAdminEnv, /^cc_admin_session=.+/);
        assert.equal(banco.totalConsultas(), antes);

        const sessao = await requisicao('/api/auth/session', { headers: { Cookie: cookieAdminEnv } });
        assert.equal(sessao.status, 200);
        assert.equal((await sessao.json()).usuario.is_admin, 1);
    });

    await t.test('cadastro de produto é idempotente e nova chave cria outro produto', async () => {
        const payload = { nome: 'Produto Idempotente', preco: 59.9, estoque: 5, descricao: 'D', sobre: 'S', informacoes: 'I', fotosOrdenadas: [{ existente: 'https://res.cloudinary.com/test/image/upload/prod.jpg' }], variantes: [] };
        const criar = chave => requisicao('/api/produtos', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv, 'Idempotency-Key': chave }, body: JSON.stringify(payload) });
        const primeira = await criar('produto-ABC-1234567890');
        assert.equal(primeira.status, 201);
        const primeiroId = (await primeira.json()).id;
        const repetida = await criar('produto-ABC-1234567890');
        assert.equal(repetida.status, 200);
        assert.equal((await repetida.json()).id, primeiroId);
        assert.equal(banco.produtos.filter(p => p.nome === payload.nome).length, 1);
        const nova = await criar('produto-XYZ-1234567890');
        assert.equal(nova.status, 201);
        assert.notEqual((await nova.json()).id, primeiroId);
    });

    await t.test('preço por versão sanitiza, aplica fallback e rejeita versão inexistente', () => {
        const variantes = __test.sanitizarVariantes([{ nome: 'A', preco: 39.9 }, { nome: 'B', preco: 69.9 }, { nome: 'C', preco: '' }, { nome: 'Inválida', preco: 'texto' }]);
        const produto = __test.normalizarProduto({ preco: 59.9, preco_promocional: 0, promocao_ativa: 0, variantes: JSON.stringify(variantes) });
        assert.equal(__test.precoEfetivoDaVariante(produto, 'A'), 39.9);
        assert.equal(__test.precoEfetivoDaVariante(produto, 'B'), 69.9);
        assert.notEqual(__test.precoEfetivoDaVariante(produto, 'B'), 1, 'preço adulterado no navegador não participa do cálculo');
        assert.equal(__test.precoEfetivoDaVariante(produto, 'C'), 59.9);
        assert.equal(__test.precoEfetivoDaVariante(produto, 'Inválida'), 59.9);
        assert.throws(() => __test.precoEfetivoDaVariante(produto, '999x999'), /não está mais disponível/i);
    });

    await t.test('autoplay aceita os limites documentados e rejeita valores fora da faixa', () => {
        assert.equal(__test.prepararIntervaloVitrine({ intervalo_ms: 200 }), 200);
        assert.equal(__test.prepararIntervaloVitrine({ intervalo_ms: 5000 }), 5000);
        assert.equal(__test.prepararIntervaloVitrine({ intervalo_ms: 1800000 }), 1800000);
        assert.throws(() => __test.prepararIntervaloVitrine({ intervalo_ms: 199 }), /entre 200 ms e 30 minutos/i);
        assert.throws(() => __test.prepararIntervaloVitrine({ intervalo_ms: 1800001 }), /entre 200 ms e 30 minutos/i);
        assert.throws(() => __test.prepararIntervaloVitrine({ intervalo_ms: 5000.5 }), /entre 200 ms e 30 minutos/i);
    });

    await t.test('editor de recibos restringe logo, tags e conteúdo executável', () => {
        const config = __test.prepararConfigRecibo({
            titulo: '<script>Recibo</script>',
            logo_url: 'https://localhost/arquivo.png',
            campos: ['pedido.codigo', 'campo.inexistente', 'itens.tabela']
        });
        assert.equal(config.logo_url, '');
        assert.equal(config.titulo.includes('<'), false);
        assert.deepEqual(config.campos, ['pedido.codigo', 'itens.tabela']);
        assert.match(__test.prepararConfigRecibo({ logo_url:'https://res.cloudinary.com/demo/image/upload/logo.png' }).logo_url, /^https:\/\/res\.cloudinary\.com\//);
    });

    await t.test('PDFKit carrega Helvetica e Helvetica-Bold e produz um Buffer PDF real', async () => {
        const pdf = await new Promise((resolve, reject) => {
            const partes = [];
            const doc = new PDFDocument({ size:'A4' });
            doc.on('data', parte => partes.push(parte));
            doc.once('end', () => resolve(Buffer.concat(partes)));
            doc.once('error', reject);
            doc.font('Helvetica');
            doc.text('Teste');
            doc.font('Helvetica-Bold');
            doc.text('Core Case');
            doc.end();
        });
        assert.ok(Buffer.isBuffer(pdf));
        assert.ok(pdf.length > 0);
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    });

    await t.test('PDF de recibo contém um documento válido com múltiplos itens', async () => {
        const config = __test.prepararConfigRecibo({ campos:['pedido.codigo','cliente.nome','itens.tabela','pedido.total'] });
        const pdf = await __test.gerarPdfRecibo({
            pedido:{ codigo:'TESTE-1234', total:159.8 }, cliente:{ nome:'Cliente Teste' },
            itens:[{ nome:'Produto A', variante:'Preta', qtd:2, preco:49.9 }, { nome:'Produto B', variante:'Padrão', qtd:1, preco:60 }]
        }, config);
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.ok(pdf.length > 1000);
    });

    await t.test('PDF de recibo continua válido com logo inválida e um item completo', async () => {
        const pdf = await __test.gerarPdfRecibo({
            pedido:{ codigo:'UNITARIO-1', data:'2026-08-24T12:00:00Z', status:'Aprovado', subtotal:89.9, frete:10, desconto:0, total:99.9 },
            cliente:{ nome:'Cliente Unitário', cpf:'12345678900', email:'cliente@teste.local', telefone:'11999999999' },
            endereco:{ cep:'01001000', logradouro:'Praça da Sé', numero:'1', bairro:'Sé', cidade:'São Paulo', estado:'SP' },
            pagamento:{ forma:'Pix', id:'MP-UNITARIO-1' },
            itens:[{ nome:'Produto Único', variante:'Preta', qtd:1, preco:89.9 }]
        }, {
            titulo:'Recibo Core Case', texto:'Comprovante {{pedido.codigo}}', observacoes:'Pagamento confirmado.', rodape:'Core Case',
            logo_url:'url-invalida', campos:['pedido.codigo','cliente.nome','endereco.logradouro','pedido.total','itens.tabela']
        });
        assert.ok(pdf.length > 1000);
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    });

    await t.test('gerarPdfRecibo rejeita falhas síncronas sem deixar exceção escapar', async () => {
        const config = __test.prepararConfigRecibo({ campos:['pedido.codigo'] });
        const dados = { pedido:{ get codigo() { throw new Error('falha controlada na inicialização'); } } };
        await assert.rejects(__test.gerarPdfRecibo(dados, config), /falha controlada na inicialização/);
    });

    await t.test('editor salva template e gerador produz PDF manual e automático', async () => {
        const salvar = await requisicao('/api/admin/recibos/config', {
            method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookieAdminEnv },
            body:JSON.stringify({ titulo:'Recibo de teste', texto:'Cliente: {{cliente.nome}}', campos:['pedido.codigo','itens.tabela','pedido.total'] })
        });
        assert.equal(salvar.status, 200);
        const config = await (await requisicao('/api/admin/recibos/config', { headers:{ Cookie:cookieAdminEnv } })).json();
        assert.equal(config.titulo, 'Recibo de teste');

        const manual = await requisicao('/api/admin/recibos/pdf', {
            method:'POST', headers:{ 'Content-Type':'application/json', Cookie:cookieAdminEnv },
            body:JSON.stringify({ dados:{ pedido:{ codigo:'MANUAL-1', total:159.8 }, cliente:{ nome:'Cliente' }, itens:[{ nome:'A', qtd:2, preco:49.9 }, { nome:'B', qtd:1, preco:60 }] } })
        });
        assert.equal(manual.status, 200);
        assert.equal(manual.headers.get('content-type'), 'application/pdf');
        assert.match(manual.headers.get('content-disposition') || '', /recibo-core-case-/);
        const pdfManual = Buffer.from(await manual.arrayBuffer());
        assert.ok(pdfManual.length > 0);
        assert.equal(pdfManual.subarray(0, 5).toString(), '%PDF-');

        const statusOriginal = banco.pedidos[0].status;
        try {
            for (const status of ['Aprovado', 'Finalizado', 'Entregue']) {
                banco.pedidos[0].status = status;
                const automatico = await requisicao('/api/admin/recibos/pdf', {
                    method:'POST', headers:{ 'Content-Type':'application/json', Cookie:cookieAdminEnv },
                    body:JSON.stringify({ pedido_id:1042, dados:{ cliente:{ nome:'Nome editado após autofill' } } })
                });
                assert.equal(automatico.status, 200, `pedido ${status} gera recibo`);
                assert.equal(automatico.headers.get('content-type'), 'application/pdf');
                assert.match(automatico.headers.get('content-disposition') || '', /recibo-core-case-/);
                const pdfAutomatico = Buffer.from(await automatico.arrayBuffer());
                assert.equal(pdfAutomatico.subarray(0, 5).toString(), '%PDF-');
            }
        } finally {
            banco.pedidos[0].status = statusOriginal;
        }
    });

    await t.test('adapter Netlify preserva PDF byte a byte em resposta Base64', async () => {
        const dados = {
            pedido:{ codigo:'TESTE-001', status:'Aprovado', subtotal:100, frete:0, desconto:0, total:100 },
            cliente:{ nome:'Teste' },
            itens:[{ nome:'Produto Teste', variante:'Padrão', qtd:1, preco:100 }]
        };
        const config = __test.prepararConfigRecibo({
            titulo:'CORE CASE - RECIBO', texto:'Pedido: {{pedido.codigo}}',
            campos:['cliente.nome','itens.tabela','pedido.total'], rodape:'CORE CASE'
        });
        const antesDoAdapter = await __test.gerarPdfRecibo(dados, config);
        const adapterDeIntegridade = serverless((req, res) => {
            res.writeHead(200, {
                'Content-Type':'application/pdf',
                'Content-Length':antesDoAdapter.length
            });
            res.end(antesDoAdapter);
        }, { binary:['application/pdf'] });
        const eventoBase = {
            httpMethod:'POST', path:'/teste-pdf', headers:{ 'content-type':'application/json' },
            body:'{}', isBase64Encoded:false, queryStringParameters:null,
            requestContext:{ identity:{ sourceIp:'127.0.0.1' } }
        };
        const respostaAdapter = await adapterDeIntegridade(eventoBase, {});
        assert.equal(respostaAdapter.statusCode, 200);
        assert.equal(respostaAdapter.headers['content-type'], 'application/pdf');
        assert.equal(respostaAdapter.isBase64Encoded, true);
        const depoisDoAdapter = Buffer.from(respostaAdapter.body, 'base64');
        assert.equal(antesDoAdapter.equals(depoisDoAdapter), true);
        const substituicaoUtf8 = Buffer.from([0xef, 0xbf, 0xbd]);
        assert.equal(depoisDoAdapter.indexOf(substituicaoUtf8), antesDoAdapter.indexOf(substituicaoUtf8));
        assert.equal(Number(respostaAdapter.headers['content-length']), depoisDoAdapter.length);

        const respostaFunction = await netlifyHandler({
            ...eventoBase,
            path:'/api/admin/recibos/pdf',
            headers:{ 'content-type':'application/json', cookie:cookieAdminEnv },
            body:JSON.stringify({ dados })
        }, {});
        assert.equal(respostaFunction.statusCode, 200);
        assert.equal(respostaFunction.headers['content-type'], 'application/pdf');
        assert.match(respostaFunction.headers['content-disposition'] || '', /recibo-core-case-/);
        assert.equal(respostaFunction.isBase64Encoded, true);
        const pdfFunction = Buffer.from(respostaFunction.body, 'base64');
        assert.equal(pdfFunction.subarray(0, 5).toString(), '%PDF-');
        assert.equal(pdfFunction.indexOf(substituicaoUtf8), -1);
        assert.equal(Number(respostaFunction.headers['content-length']), pdfFunction.length);
    });

    await t.test('reembolso exige pagamento Mercado Pago e status final real', () => {
        assert.equal(__test.pedidoElegivelReembolso({ status:'Finalizado', mercadopago_id:'MP-1' }), true);
        assert.equal(__test.pedidoElegivelReembolso({ status:'Entregue', mercadopago_id:'MP-2' }), true);
        assert.equal(__test.pedidoElegivelReembolso({ status:'Em Processamento', mercadopago_id:'MP-3' }), false);
        assert.equal(__test.pedidoElegivelReembolso({ status:'Finalizado', mercadopago_id:null }), false);
    });

    await t.test('interfaces mantêm card acessível, botões protegidos e Home sem chamadas por seção', () => {
        const loja = fs.readFileSync(path.join(__dirname, '..', 'public', 'loja.html'), 'utf8');
        const home = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
        const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
        assert.match(loja, /role="link" tabindex="0"/);
        assert.match(loja, /event\.target!==this/);
        assert.match(loja, /event\.stopPropagation\(\);adicionarAoCarrinhoPorId/);
        assert.match(home, /Promise\.all\(\[fetch\('\/api\/vitrine'\), fetch\('\/api\/loja\/bootstrap'\)\]\)/);
        assert.match(admin, />Operação</);
        assert.match(admin, />Catálogo \/ Loja</);
    });

    await t.test('refinamento mantém Recibos separado, fila integrada, gráficos nativos e header em linha', () => {
        const raiz = path.join(__dirname, '..', 'public');
        const financeiro = fs.readFileSync(path.join(raiz, 'admin-financeiro.html'), 'utf8');
        const recibos = fs.readFileSync(path.join(raiz, 'admin-recibos.html'), 'utf8');
        const recibosJs = fs.readFileSync(path.join(raiz, 'recibos.js'), 'utf8');
        const fila = fs.readFileSync(path.join(raiz, 'admin-servicos.js'), 'utf8');
        const analise = fs.readFileSync(path.join(raiz, 'admin-analise.js'), 'utf8');
        const home = fs.readFileSync(path.join(raiz, 'home.js'), 'utf8');
        const usuario = fs.readFileSync(path.join(raiz, 'usuario.js'), 'utf8');
        const admin = fs.readFileSync(path.join(raiz, 'admin.js'), 'utf8');
        assert.doesNotMatch(financeiro, /reciboEditor|Gerador de recibo/i);
        assert.match(recibos, /data-recibo-tab="editor"/);
        assert.match(recibos, /data-recibo-tab="gerador"/);
        assert.match(recibosJs, /navigator\.clipboard\.writeText/);
        assert.match(recibosJs, /setTimeout\(atualizarPreviewRecibo, 120\)/);
        assert.match(admin, /admin-recibos\.html/);
        assert.match(admin, />Visão financeira</);
        for (const filtro of ['todos','pedidos','reembolsos']) assert.match(fila, new RegExp(`filtroFila !== '${filtro === 'todos' ? 'impossivel' : filtro}'|${filtro}`));
        assert.match(fila, /produtosPedidoHtml\(pedido\)/);
        assert.match(analise, /numeroSeguro/);
        assert.match(analise, /criarSvg/);
        assert.doesNotMatch(analise, /Chart\.|chart\.js/i);
        assert.match(home, /animando: false/);
        assert.match(home, /Math\.min\(420, Math\.floor\(estado\.intervaloMs \* \.55\)\)/);
        assert.match(home, /prefers-reduced-motion: reduce/);
        assert.match(usuario, /flex-direction:row;align-items:center;gap:8px/);
    });

    await t.test('Fila e Analise expõem solicitações persistidas sem reduzir faturamento', async () => {
        const fila = await requisicao('/api/pedidos', { headers:{ Cookie:cookieAdminEnv } });
        assert.equal(fila.status, 200);
        const pedidos = await fila.json();
        assert.equal(pedidos[0].reembolso_status, 'solicitado');
        assert.equal(pedidos[0].produtos.length, 2);

        const resposta = await requisicao('/api/admin/analytics/resumo?data_inicio=2026-08-18&data_fim=2026-08-24', { headers:{ Cookie:cookieAdminEnv } });
        assert.equal(resposta.status, 200);
        const dados = await resposta.json();
        assert.equal(dados.resumo.faturamento_aprovado, 159.8);
        assert.equal(dados.resumo.solicitacoes_reembolso, 1);
        assert.deepEqual(dados.reembolsosPorDia, [{ dia:'2026-08-24', solicitacoes:1 }]);
        assert.equal(Number.isNaN(dados.resumo.ticket_medio), false);
    });

    await t.test('formulário bloqueia submit duplo e sempre reativa o botão', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-produtos.html'), 'utf8');
        const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'rich-editor.js'), 'utf8');
        assert.match(html, /if \(salvandoProduto\) return;/);
        assert.match(html, /salvandoProduto = true;[\s\S]*botao\.disabled = true;/);
        assert.match(html, /finally\s*\{[\s\S]*salvandoProduto = false;[\s\S]*botao\.disabled = false;/);
        assert.doesNotMatch(html, /setTimeout\(\(\) => editarProduto/);
        assert.match(editor, /if \(eraObrigatorio\) textarea\.required = false;/);
        assert.match(editor, /area\.setAttribute\('aria-required', 'true'\)/);
        for (const id of ['pDesc', 'pSobre', 'pInfo']) {
            assert.match(html, new RegExp(`obterConteudoEditorRico\\('${id}'\\)`));
        }
        assert.match(html, /focarEditorRico\(idEditor\)/);
    });

    await t.test('senha errada do admin nao cria sessao', async () => {
        const resposta = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: process.env.ADMIN_USER, senha: 'incorreta' })
        });
        assert.equal(resposta.status, 401);
        assert.equal(extrairCookie(resposta, 'cc_admin_session'), '');
    });

    await t.test('rota admin aceita cookie admin e nega requisicao anonima', async () => {
        assert.equal((await requisicao('/api/usuarios', { headers: { Cookie: cookieAdminEnv } })).status, 200);
        assert.equal((await requisicao('/api/usuarios')).status, 403);
    });

    await t.test('admin por cc_admin_session cria comentario sem X-Admin-Token e sem usuario_id', async () => {
        const resposta = await requisicao('/api/produtos/1/comentarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({ nota: 5, texto: 'Comentario administrativo', nome_manual: 'Equipe Core Case' })
        });
        assert.equal(resposta.status, 201);
        assert.equal(banco.comentarios.at(-1).usuario_id, null);
        assert.equal(banco.comentarios.at(-1).nome_manual, 'Equipe Core Case');
    });

    await t.test('admin publica avaliação somente com nota', async () => {
        const resposta = await requisicao('/api/produtos/1/comentarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({ nota: 5, texto: '', nome_manual: 'Equipe Core Case' })
        });
        assert.equal(resposta.status, 201);
        assert.equal(banco.comentarios.at(-1).texto, '');
    });

    let cookieAdminBanco;
    await t.test('usuario is_admin do banco continua autorizado', async () => {
        const login = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin-banco@teste.local', senha: 'Admin123' })
        });
        assert.equal(login.status, 200);
        cookieAdminBanco = extrairCookie(login, 'cc_session');
        assert.equal((await requisicao('/api/usuarios', { headers: { Cookie: cookieAdminBanco } })).status, 200);
    });

    await t.test('usuario is_admin do banco cria comentario administrativo sem usuario_id', async () => {
        const resposta = await requisicao('/api/produtos/1/comentarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminBanco },
            body: JSON.stringify({ nota: 4, texto: 'Comentario do admin banco', nome_manual: 'Admin Banco' })
        });
        assert.equal(resposta.status, 201);
        assert.equal(banco.comentarios.at(-1).usuario_id, null);
        assert.equal(banco.comentarios.at(-1).nome_manual, 'Admin Banco');
    });

    await t.test('anonimo sem usuario_id continua proibido ao comentar', async () => {
        const resposta = await requisicao('/api/produtos/1/comentarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nota: 5, texto: 'Comentario anonimo' })
        });
        assert.equal(resposta.status, 403);
    });

    await t.test('X-Admin-Token legado continua criando comentario administrativo', async () => {
        const resposta = await requisicao('/api/produtos/1/comentarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN },
            body: JSON.stringify({ nota: 5, texto: 'Comentario legado', nome_manual: 'Admin legado' })
        });
        assert.equal(resposta.status, 201);
        assert.equal(banco.comentarios.at(-1).usuario_id, null);
        assert.equal(banco.comentarios.at(-1).nome_manual, 'Admin legado');
    });

    await t.test('produto por id mantem contrato, cache curto e nao mistura ids', async () => {
        const produto4 = await requisicao('/api/produtos/4');
        assert.equal(produto4.status, 200);
        assert.equal(produto4.headers.get('cache-control'), 'public, max-age=0, s-maxage=20, stale-while-revalidate=30');
        assert.match(produto4.headers.get('server-timing') || '', /product;dur=/);
        const dados4 = await produto4.json();
        assert.equal(dados4.id, 4);
        assert.equal(dados4.nome, 'Produto Quatro');
        assert.equal(dados4.preco, 40);
        assert.equal(dados4.preco_promocional, 35);

        const produto3 = await requisicao('/api/produtos/3');
        assert.equal(produto3.status, 200);
        const dados3 = await produto3.json();
        assert.equal(dados3.id, 3);
        assert.equal(dados3.nome, 'Produto Tres');
        assert.notEqual(dados3.id, dados4.id);
    });

    await t.test('produto inexistente continua 404 sem cache publico', async () => {
        const resposta = await requisicao('/api/produtos/999');
        assert.equal(resposta.status, 404);
        assert.equal(resposta.headers.get('cache-control'), 'no-store');
    });

    await t.test('vitrine publica vazia usa apenas dados publicos e cache curto', async () => {
        const resposta = await requisicao('/api/vitrine');
        assert.equal(resposta.status, 200);
        assert.equal(resposta.headers.get('cache-control'), 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
        const dados = await resposta.json();
        assert.deepEqual(dados.destaques, []);
        assert.deepEqual(dados.categorias, []);
        assert.equal(dados.rodape.email, 'corecasesolucoes@gmail.com');
        assert.equal(Object.hasOwn(dados, 'id'), false);
    });

    await t.test('escrita da vitrine exige acesso administrativo', async () => {
        const resposta = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secao: 'rodape', dados: { email: 'contato@teste.local', descricao: 'Core Case' } })
        });
        assert.equal(resposta.status, 403);
    });

    await t.test('admin salva destaque e categoria usando o storage de imagens existente', async () => {
        const imagem = 'data:image/jpeg;base64,aW1hZ2VtLXRlc3Rl';
        const destaque = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({
                secao: 'destaques',
                dados: [{
                    chave: 'destaque-teste-1', produto_id: 4, ordem: 1, ativo: true,
                    imagem_desktop_base64: imagem, imagem_mobile_base64: imagem
                }]
            })
        });
        assert.equal(destaque.status, 200);

        const categoria = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({
                secao: 'categorias',
                dados: [
                    { chave: 'categoria-teste-1', categoria_id: 10, legenda: 'Seu som, em qualquer lugar.', ordem: 1, ativo: true, imagem_base64: imagem },
                    { chave: 'categoria-teste-2', categoria_id: 11, legenda: 'Conecte sua rotina.', ordem: 2, ativo: false, imagem_base64: imagem }
                ]
            })
        });
        assert.equal(categoria.status, 200);
        assert.deepEqual(uploadsVitrine.map(item => item.prefixo), [
            'vitrine-destaque-desktop', 'vitrine-destaque-mobile', 'vitrine-categoria', 'vitrine-categoria'
        ]);
    });

    await t.test('endpoint publico associa IDs reais e omite item inativo', async () => {
        const resposta = await requisicao('/api/vitrine');
        assert.equal(resposta.status, 200);
        const dados = await resposta.json();
        assert.equal(dados.destaques.length, 1);
        assert.equal(dados.destaques[0].produto_id, 4);
        assert.equal(dados.destaques[0].produto_nome, 'Produto Quatro');
        assert.equal(dados.categorias.length, 1);
        assert.equal(dados.categorias[0].categoria_slug, 'fones');
        assert.equal(dados.categorias.some(item => item.categoria_slug === 'cabos'), false);
        assert.match(dados.destaques[0].imagem_desktop, /^https:\/\/res\.cloudinary\.com\/test\//);
    });

    await t.test('backend bloqueia mais de tres destaques ativos', async () => {
        const existentes = JSON.parse(banco.configuracoes.home_vitrine_destaques_json);
        const base = existentes[0];
        const resposta = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({
                secao: 'destaques',
                dados: [1, 2, 3, 4].map((numero, indice) => ({
                    ...base,
                    chave: `destaque-limite-${numero}`,
                    produto_id: indice % 2 ? 3 : 4,
                    ordem: (indice % 3) + 1,
                    ativo: true
                }))
            })
        });
        assert.equal(resposta.status, 400);
        assert.match((await resposta.json()).erro, /maximo 3/i);
    });

    await t.test('rodape rejeita e-mail invalido e persiste conteudo valido', async () => {
        const invalido = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({ secao: 'rodape', dados: { email: 'email-invalido', descricao: 'Core Case' } })
        });
        assert.equal(invalido.status, 400);

        const valido = await requisicao('/api/admin/vitrine', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookieAdminEnv },
            body: JSON.stringify({ secao: 'rodape', dados: { email: 'contato@corecase.local', descricao: 'Produtos selecionados para sua rotina.' } })
        });
        assert.equal(valido.status, 200);
        const publico = await (await requisicao('/api/vitrine')).json();
        assert.equal(publico.rodape.email, 'contato@corecase.local');
    });

    await t.test('logout admin remove cc_admin_session', async () => {
        const logout = await requisicao('/api/auth/logout', { method: 'POST', headers: { Cookie: cookieAdminEnv } });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get('set-cookie') || '', /cc_admin_session=;[^,]*Max-Age=0/);
        assert.equal((await requisicao('/api/usuarios')).status, 403);
    });

    await t.test('logout cliente revoga e remove cc_session', async () => {
        const logout = await requisicao('/api/auth/logout', { method: 'POST', headers: { Cookie: cookieCliente } });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get('set-cookie') || '', /cc_session=;[^,]*Max-Age=0/);
        assert.ok(banco.sessoes[0].revogado_em instanceof Date);
    });

    await new Promise(resolve => servidor.close(resolve));
    imageStorage.salvarImagemBase64 = salvarImagemOriginal;
    __test.restaurar();
});
