const mpService = require('./mercadopagoService');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(
    path.join(__dirname, 'banco.db'),
    (err) => {
        if (err) {
            console.error('Erro ao abrir banco:', err.message);
        } else {
            console.log('Banco SQLite conectado.');
        }
    }
);
const pastaUploads = path.join(__dirname, 'uploads');
const pastaPublic = path.join(__dirname, 'public');
const ADMIN_TOKEN =
process.env.ADMIN_TOKEN ||
'core-case-admin-token';

if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}
if (!fs.existsSync(pastaPublic)) {
    fs.mkdirSync(pastaPublic, { recursive: true });
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        cpf TEXT UNIQUE,
        cep TEXT,
        endereco TEXT,
        telefone TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        foto TEXT,
        is_admin INTEGER DEFAULT 0
    )`);
// Código Superior: Verifica se a coluna mercadopago_id já existe antes de tentar adicioná-la
    db.all("PRAGMA table_info(pedidos)", [], (err, colunas) => {
        if (!err && colunas && !colunas.some(coluna => coluna.name === 'mercadopago_id')) {
            db.run("ALTER TABLE pedidos ADD COLUMN mercadopago_id TEXT");
            console.log("Coluna 'mercadopago_id' adicionada com sucesso à tabela pedidos.");
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        preco REAL,
        descricao TEXT,
        sobre TEXT,
        informacoes TEXT,
        foto TEXT,
        max_parcelas INTEGER DEFAULT 12,
        juros_mensal REAL DEFAULT 0.0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_pedido INTEGER,
        cliente_id INTEGER,
        nome_recebedor TEXT,
        endereco_envio TEXT,
        produtos_json TEXT,
        total REAL,
        forma_pagamento TEXT,
        status TEXT
    )`);
    // ======================================================
// CONFIGURAÇÕES FINANCEIRAS
// Mercado Pago + PIX + Futuras integrações
// ======================================================

db.run(`
CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    public_key TEXT,
    access_token TEXT,

    chave_pix TEXT,
    nome_recebedor TEXT,

    ambiente TEXT DEFAULT 'sandbox',

    banco TEXT,
    agencia TEXT,
    conta TEXT,

    taxa_entrega REAL DEFAULT 0,
    frete_gratis_acima REAL DEFAULT 0
)
`);
db.get(
    `SELECT * FROM configuracoes LIMIT 1`,
    (err,row)=>{

        if(!row){

            db.run(`
                INSERT INTO configuracoes(
                    public_key,
                    access_token,
                    chave_pix,
                    nome_recebedor,
                    ambiente
                )
                VALUES(
                    '',
                    '',
                    '',
                    '',
                    'sandbox'
                )
            `);

        }

    }
);

    db.all("PRAGMA table_info(usuarios)", [], (err, colunas) => {
        if (!err && !colunas.some(coluna => coluna.name === 'is_admin')) {
            db.run("ALTER TABLE usuarios ADD COLUMN is_admin INTEGER DEFAULT 0");
        }
    });

    db.all("PRAGMA table_info(produtos)", [], (err, colunas) => {
        if (err) return;
        if (!colunas.some(coluna => coluna.name === 'max_parcelas')) {
            db.run("ALTER TABLE produtos ADD COLUMN max_parcelas INTEGER DEFAULT 12");
        }
        if (!colunas.some(coluna => coluna.name === 'juros_mensal')) {
            db.run("ALTER TABLE produtos ADD COLUMN juros_mensal REAL DEFAULT 0.0");
        }
    });
    // ======================================================
// MIGRAÇÕES CONFIGURAÇÕES
// ======================================================

db.all(
    "PRAGMA table_info(configuracoes)",
    [],
    (err, colunas) => {

        if(err) return;

        if(!colunas.some(c=>c.name==="banco")){
            db.run("ALTER TABLE configuracoes ADD COLUMN banco TEXT");
        }

        if(!colunas.some(c=>c.name==="agencia")){
            db.run("ALTER TABLE configuracoes ADD COLUMN agencia TEXT");
        }

        if(!colunas.some(c=>c.name==="conta")){
            db.run("ALTER TABLE configuracoes ADD COLUMN conta TEXT");
        }

        if(!colunas.some(c=>c.name==="taxa_entrega")){
            db.run("ALTER TABLE configuracoes ADD COLUMN taxa_entrega REAL DEFAULT 0");
        }

        if(!colunas.some(c=>c.name==="frete_gratis_acima")){
            db.run("ALTER TABLE configuracoes ADD COLUMN frete_gratis_acima REAL DEFAULT 0");
        }

    }
);
});

function enviarJson(res, status, dados) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(dados));
}

function coletarJson(corpo) {
    try {
        if (!corpo) return {};
        return JSON.parse(corpo);
    } catch (err) {
        return {};
    }
}

function salvarFotosBase64(fotosBase64) {
    const fotos = [];

    if (Array.isArray(fotosBase64)) {
        fotosBase64.forEach((base64, index) => {
            if (typeof base64 === 'string' && base64.includes(',')) {
                const nomeFoto = `prod-${Date.now()}-${index}.jpg`;
                const buffer = Buffer.from(base64.split(',')[1], 'base64');
                fs.writeFileSync(path.join(pastaUploads, nomeFoto), buffer);
                fotos.push(`/uploads/${nomeFoto}`);
            }
        });
    }

    return fotos;
}

function normalizarProduto(produto) {
    return {
        ...produto,
        preco: Number(produto.preco || 0),
        max_parcelas: Number(produto.max_parcelas || 12),
        juros_mensal: Number(produto.juros_mensal || 0)
    };
}

function criarHashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(senha || ''), salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}

function senhaConfere(senhaInformada, senhaSalva) {
    const senha = String(senhaInformada || '');
    const salva = String(senhaSalva || '');

    if (!salva.startsWith('pbkdf2:')) {
        return senha === salva;
    }

    const partes = salva.split(':');
    if (partes.length !== 3) return false;

    const [, salt, hash] = partes;
    const hashInformado = crypto.pbkdf2Sync(senha, salt, 100000, 64, 'sha512').toString('hex');
    const bufferInformado = Buffer.from(hashInformado, 'hex');
    const bufferSalvo = Buffer.from(hash, 'hex');
    if (bufferInformado.length !== bufferSalvo.length) return false;
    return crypto.timingSafeEqual(bufferInformado, bufferSalvo);
}

function temAcessoAdmin(req) {
    return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

function exigirAcessoAdmin(req, res) {
    if (temAcessoAdmin(req)) return true;
    enviarJson(res, 403, { erro: 'Acesso administrativo necessario.' });
    return false;
}

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
        res.writeHead(200, { 'Content-Type': tipos[ext] || 'application/octet-stream' });
        res.end(content);
    });
}

const servidor = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
'Access-Control-Allow-Headers',
'Content-Type, X-Admin-Token'
);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const urlParse = req.url.split('?')[0];

    if (req.method === 'GET' && urlParse.startsWith('/uploads/')) {
        const caminhoFoto = path.normalize(path.join(__dirname, urlParse));
        if (!caminhoFoto.startsWith(pastaUploads)) {
            res.writeHead(403);
            res.end();
            return;
        }

        fs.readFile(caminhoFoto, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end();
                return;
            }

            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(data);
        });
        return;
    }

    let corpo = '';
    req.on('data', chunk => {
        corpo += chunk.toString();
    });

    req.on('end', () => {
        if (urlParse === '/api/produtos' && req.method === 'GET') {
            db.all('SELECT * FROM produtos ORDER BY id DESC', [], (err, rows) => {
                if (err) return enviarJson(res, 500, { erro: err.message });
                enviarJson(res, 200, (rows || []).map(normalizarProduto));
            });
            return;
        }

        if (urlParse.startsWith('/api/produtos/') && req.method === 'GET') {
            const id = urlParse.split('/').pop();
            db.get('SELECT * FROM produtos WHERE id = ?', [id], (err, row) => {
                if (err) return enviarJson(res, 500, { erro: err.message });
                if (!row) return enviarJson(res, 404, { erro: 'Produto nao encontrado.' });
                enviarJson(res, 200, normalizarProduto(row));
            });
            return;
        }

        if (urlParse === '/api/produtos' && req.method === 'POST') {
            if (!exigirAcessoAdmin(req, res)) return;
            try {
                const dados = coletarJson(corpo);
                const fotos = salvarFotosBase64(dados.fotosBase64);
                const fotosFinais = fotos.length ? fotos : ['https://via.placeholder.com/450?text=Core+Case'];

                db.run(
                    `INSERT INTO produtos (nome, preco, descricao, sobre, informacoes, foto, max_parcelas, juros_mensal)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        dados.nome,
                        Number(dados.preco || 0),
                        dados.descricao || '',
                        dados.sobre || '',
                        dados.informacoes || '',
                        JSON.stringify(fotosFinais),
                        Number(dados.max_parcelas || 12),
                        Number(dados.juros_mensal || 0)
                    ],
                    function (err) {
                        if (err) return enviarJson(res, 500, { erro: 'Erro ao gravar o produto.' });
                        enviarJson(res, 201, { sucesso: true, id: this.lastID });
                    }
                );
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados do produto invalidos.' });
            }
            return;
        }

        if (urlParse.startsWith('/api/produtos/') && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;
            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                const novasFotos = salvarFotosBase64(dados.fotosBase64);
                const fotosExistentes = Array.isArray(dados.fotosExistentes) ? dados.fotosExistentes : [];
                const fotosFinais = novasFotos.length ? [...fotosExistentes, ...novasFotos] : fotosExistentes;

                db.run(
                    `UPDATE produtos
                     SET nome = ?, preco = ?, descricao = ?, sobre = ?, informacoes = ?, foto = ?, max_parcelas = ?, juros_mensal = ?
                     WHERE id = ?`,
                    [
                        dados.nome,
                        Number(dados.preco || 0),
                        dados.descricao || '',
                        dados.sobre || '',
                        dados.informacoes || '',
                        JSON.stringify(fotosFinais.length ? fotosFinais : ['https://via.placeholder.com/450?text=Core+Case']),
                        Number(dados.max_parcelas || 12),
                        Number(dados.juros_mensal || 0),
                        id
                    ],
                    function (err) {
                        if (err) return enviarJson(res, 500, { erro: 'Erro ao atualizar o produto.' });
                        enviarJson(res, 200, { sucesso: this.changes > 0 });
                    }
                );
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados do produto invalidos.' });
            }
            return;
        }

        if (urlParse.startsWith('/api/produtos/') && req.method === 'DELETE') {
            if (!exigirAcessoAdmin(req, res)) return;
            const id = urlParse.split('/').pop();
            db.run('DELETE FROM produtos WHERE id = ?', [id], function (err) {
                if (err) return enviarJson(res, 500, { erro: 'Erro ao excluir o produto.' });
                enviarJson(res, 200, { sucesso: this.changes > 0 });
            });
            return;
        }

        if (urlParse === '/api/cadastro' && req.method === 'POST') {
            try {
                const dados = coletarJson(corpo);
                let nomeFoto = 'default.jpg';

                if (dados.fotoBase64 && dados.fotoBase64.includes(',')) {
                    nomeFoto = `perfil-${Date.now()}.jpg`;
                    const buffer = Buffer.from(dados.fotoBase64.split(',')[1], 'base64');
                    fs.writeFileSync(path.join(pastaUploads, nomeFoto), buffer);
                }

                db.run(
                    `INSERT INTO usuarios (nome, cpf, cep, endereco, telefone, email, senha, foto, is_admin)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                    [dados.nome, dados.cpf, dados.cep, dados.endereco, dados.telefone, dados.email, criarHashSenha(dados.senha), nomeFoto],
                    function (err) {
                        if (err) return enviarJson(res, 400, { erro: 'CPF ou e-mail ja cadastrados.' });
                        enviarJson(res, 201, { sucesso: true, id: this.lastID });
                    }
                );
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados de cadastro invalidos.' });
            }
            return;
        }

        if (urlParse === '/api/login' && req.method === 'POST') {
            try {
                const dados = coletarJson(corpo);
                const login = String(dados.email || '').trim();
                const senha = String(dados.senha || '');

                if (login === 'admin' && senha === 'System') {
                    return enviarJson(res, 200, {
                        sucesso: true,
                        usuario: {
                            id: 0,
                            nome: 'Administrador',
                            email: 'admin',
                            is_admin: 1
                        },
                        adminToken: ADMIN_TOKEN
                    });
                }

                db.get(
                    `SELECT * FROM usuarios WHERE email = ?`,
                    [login],
                    (err, row) => {
                        if (err) return enviarJson(res, 500, { erro: err.message });
                        if (!row || !senhaConfere(senha, row.senha)) {
                            return enviarJson(res, 401, { sucesso: false, erro: 'Login ou senha incorretos.' });
                        }

                        if (!String(row.senha || '').startsWith('pbkdf2:')) {
                            db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [criarHashSenha(senha), row.id]);
                        }

                        delete row.senha;
                        enviarJson(res, 200, {
                            sucesso: true,
                            usuario: row,
                            adminToken: Number(row.is_admin) === 1 ? ADMIN_TOKEN : null
                        });
                    }
                );
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados de login invalidos.' });
            }
            return;
        }

        if (urlParse === '/api/usuarios' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;
            db.all(
                `SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin
                 FROM usuarios ORDER BY id DESC`,
                [],
                (err, rows) => {
                    if (err) return enviarJson(res, 500, { erro: err.message });
                    enviarJson(res, 200, rows || []);
                }
            );
            return;
        }

        if (urlParse.startsWith('/api/usuarios/') && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;
            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                db.run('UPDATE usuarios SET is_admin = ? WHERE id = ?', [dados.is_admin ? 1 : 0, id], function (err) {
                    if (err) return enviarJson(res, 500, { erro: 'Erro ao atualizar usuario.' });
                    enviarJson(res, 200, { sucesso: this.changes > 0 });
                });
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados do usuario invalidos.' });
            }
            return;
        }
        // ======================================================
        // FINANCEIRO - CONSULTAR CONFIGURAÇÕES
        // ======================================================
        if (urlParse === '/api/configuracoes' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;

            db.get(
                'SELECT * FROM configuracoes LIMIT 1',
                [],
                (err, row) => {
                    if (err) {
                        return enviarJson(res, 500, {
                            erro: 'Erro ao carregar configuracoes.'
                        });
                    }
                    enviarJson(res, 200, row || {});
                }
            );
            return;
        }

        // ======================================================
        // FINANCEIRO - SALVAR CONFIGURAÇÕES
        // ======================================================
        if (urlParse === '/api/configuracoes' && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;

            const dados = coletarJson(corpo);

            db.run(
                `
                UPDATE configuracoes
                SET
                    public_key=?,
                    access_token=?,
                    chave_pix=?,
                    nome_recebedor=?,
                    ambiente=?,
                    banco=?,
                    agencia=?,
                    conta=?,
                    taxa_entrega=?,
                    frete_gratis_acima=?
                WHERE id=1
                `,
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
                ],
                function(err) {
                    if (err) {
                        return enviarJson(res, 500, {
                            erro: 'Erro ao salvar configuracoes.'
                        });
                    }
                    enviarJson(res, 200, {
                        sucesso: true
                    });
                }
            );
            return;
        }
        if (urlParse === '/api/checkout' && req.method === 'POST') {
            try {
                const dados = coletarJson(corpo);
                const codigoPedido = Math.floor(100000 + Math.random() * 900000);

                // Processa o pagamento usando o serviço isolado
                mpService.criarPagamento(db, dados, codigoPedido)
                    .then((mpResponse) => {
                        const mpId = mpResponse ? String(mpResponse.id) : null;
                        const statusInicial = dados.formaPagamento === 'pix' ? 'Pendente' : 'Em Processamento';

                        // Salva o pedido no banco vinculando ao ID do Mercado Pago
                        db.run(
                            `INSERT INTO pedidos (codigo_pedido, cliente_id, nome_recebedor, endereco_envio, produtos_json, total, forma_pagamento, status, mercadopago_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                codigoPedido,
                                dados.clienteId,
                                dados.nomeRecebedor,
                                dados.enderecoEnvio,
                                JSON.stringify(dados.produtos || []),
                                Number(dados.total || 0),
                                dados.formaPagamento,
                                statusInicial,
                                mpId
                            ],
                            function (err) {
                                if (err) {
                                    return enviarJson(res, 500, { erro: 'Erro ao gravar o pedido no banco de dados local.' });
                                }

                                // Monta a resposta base de sucesso
                                const resposta = {
                                    sucesso: true,
                                    codigo: codigoPedido,
                                    id: this.lastID,
                                    status: statusInicial
                                };

                                // Se for PIX, adiciona os dados para o cliente pagar na tela
                                if (dados.formaPagamento === 'pix' && mpResponse.point_of_interaction) {
                                    resposta.qr_code = mpResponse.point_of_interaction.transaction_data.qr_code;
                                    resposta.qr_code_base64 = mpResponse.point_of_interaction.transaction_data.qr_code_base64;
                                }

                                enviarJson(res, 200, resposta);
                            }
                        );
                    })
                    .catch((error) => {
                        console.error('Falha no processamento do Mercado Pago:', error.message);
                        enviarJson(res, 400, { erro: 'Não foi possível processar o pagamento.', detalhes: error.message });
                    });

            } catch (e) {
                enviarJson(res, 400, { erro: 'Formato de requisição inválido.' });
            }
            return;
        }
if (urlParse === '/api/webhook' && req.method === 'POST') {
            try {
                const queryParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                // O Mercado Pago envia o ID do pagamento de formas diferentes dependendo da versão do evento
                const paymentId = queryParams.get('data.id') || queryParams.get('id') || coletarJson(corpo)?.data?.id;

                if (paymentId) {
                    const { Payment } = require('mercadopago');
                    
                    // Inicializa a API para consultar o status real atualizado do pagamento
                    mpService.inicializarMercadoPago(db)
                        .then(async (paymentInstance) => {
                            const paymentInfo = await paymentInstance.get({ id: paymentId });
                            const statusMP = paymentInfo.status; // 'approved', 'pending', 'rejected'

                            let statusSistema = 'Pendente';
                            if (statusMP === 'approved') statusSistema = 'Aprovado (Pronto para Envio)';
                            if (statusMP === 'rejected') statusSistema = 'Cancelado / Recusado';

                            // Atualiza o banco com base no ID retornado
                            db.run(
                                `UPDATE pedidos SET status = ? WHERE mercadopago_id = ?`,
                                [statusSistema, String(paymentId)],
                                (err) => {
                                    if (!err) console.log(`[Webhook] Pedido MP #${paymentId} atualizado para: ${statusSistema}`);
                                }
                            );
                        })
                        .catch(err => console.error('[Webhook Error]:', err.message));
                }

                // Responde imediatamente com status 200 para o Mercado Pago saber que você recebeu
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            } catch (e) {
                res.writeHead(200); // Evita loops de erro com o Mercado Pago respondendo sucesso
                res.end('Erro processado');
            }
            return;
        }
        if (urlParse === '/api/pedidos' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;
            db.all(
                `SELECT pedidos.*, usuarios.nome as cliente_nome, usuarios.telefone, usuarios.cpf, usuarios.email, usuarios.cep, usuarios.endereco
                 FROM pedidos
                 LEFT JOIN usuarios ON pedidos.cliente_id = usuarios.id
                 ORDER BY pedidos.id DESC`,
                [],
                (err, rows) => {
                    if (err) return enviarJson(res, 500, { erro: err.message });
                    const pedidos = (rows || []).map(row => {
                        let produtos = [];
                        try {
                            produtos = JSON.parse(row.produtos_json || '[]');
                        } catch (e) {
                            produtos = [];
                        }
                        return { ...row, produtos };
                    });
                    enviarJson(res, 200, pedidos);
                }
            );
            return;
        }

        if (urlParse.startsWith('/api/pedidos/finalizar/') && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;
            const id = urlParse.split('/').pop();
            db.run(`UPDATE pedidos SET status = 'Finalizado (Entregue)' WHERE id = ?`, [id], function (err) {
                if (err) return enviarJson(res, 500, { sucesso: false });
                enviarJson(res, 200, { sucesso: this.changes > 0 });
            });
            return;
        }

        if (req.method === 'GET') {
            servirArquivo(req, res, urlParse);
            return;
        }

        enviarJson(res, 404, { erro: 'Rota nao encontrada.' });
    });
});
// Se a hospedagem definir uma porta dinâmica, usamos ela. Caso contrário, usa a porta 3000 local.
const PORT = process.env.PORT || 3000;

servidor.listen(PORT, () => {
    console.log(`Servidor rodando com sucesso na porta ${PORT}`);
});
