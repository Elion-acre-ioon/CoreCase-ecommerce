const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'admin-env-test';
process.env.ADMIN_SENHA = crypto.randomBytes(18).toString('base64url');
process.env.ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'google-client-test';

const { handleRequest, __test } = require('../api');

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
        { id: 1, nome: 'Cliente', email: 'cliente@teste.local', senha: hashSenha('Senha123'), is_admin: 0, sessao_versao: 0 },
        { id: 2, nome: 'Google', email: 'google@teste.local', senha: hashSenha('Google123'), is_admin: 0, sessao_versao: 0 },
        { id: 3, nome: 'Admin Banco', email: 'admin-banco@teste.local', senha: hashSenha('Admin123'), is_admin: 1, sessao_versao: 0 }
    ];
    const sessoes = [];
    const comentarios = [];
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
    let consultas = 0;

    async function execute(sql, parametros = []) {
        consultas++;
        const consulta = String(sql).replace(/\s+/g, ' ').trim();

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
        if (consulta.startsWith('SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin, sessao_versao FROM usuarios WHERE id = ?')) {
            const usuario = usuarios.find(item => item.id === Number(parametros[0]));
            return [usuario ? [{ ...usuario }] : [], []];
        }
        if (consulta.startsWith('SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin FROM usuarios ORDER BY id DESC')) {
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
        throw new Error(`SQL inesperado no teste: ${consulta}`);
    }

    return { execute, usuarios, sessoes, comentarios, produtos, totalConsultas: () => consultas };
}

test('regressoes de autenticacao', async t => {
    const banco = criarBancoMock();
    __test.configurarBancoPronto({ conectado: true, tabelas: {}, colunas: {}, schema_version: 2 });
    __test.configurarExecutarDb(banco.execute);
    __test.configurarGoogleOAuthClient({
        async verifyIdToken() {
            return { getPayload: () => ({ sub: 'google-2', email: 'google@teste.local', email_verified: true, name: 'Google' }) };
        }
    });

    const servidor = http.createServer(handleRequest);
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
    const requisicao = (caminho, opcoes = {}) => fetch(`${baseUrl}${caminho}`, opcoes);

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
        __test.configurarBancoPronto({ conectado: true, tabelas: {}, colunas: {}, schema_version: 2 });
    });

    let cookieCliente;
    await t.test('login normal cria cc_session no fast path', async () => {
        const resposta = await requisicao('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'cliente@teste.local', senha: 'Senha123' })
        });
        assert.equal(resposta.status, 200);
        cookieCliente = extrairCookie(resposta, 'cc_session');
        assert.match(cookieCliente, /^cc_session=.+/);
        assert.equal(banco.sessoes.length, 1);

        const sessao = await requisicao('/api/auth/session', { headers: { Cookie: cookieCliente } });
        assert.equal(sessao.status, 200);
        assert.equal((await sessao.json()).usuario.id, 1);
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
        assert.match(extrairCookie(resposta, 'cc_session'), /^cc_session=.+/);
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
    __test.restaurar();
});
