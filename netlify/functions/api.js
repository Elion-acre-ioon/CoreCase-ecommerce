const serverless = require('serverless-http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const mpService = require('../../mercadopagoService');

const app = express();

// Middleware para parsing de JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuração do banco de dados
const dbPath = path.join('/tmp', 'banco.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao abrir banco:', err.message);
    } else {
        console.log('Banco SQLite conectado.');
        inicializarBanco();
    }
});

const pastaUploads = path.join('/tmp', 'uploads');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'core-case-admin-token';

if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}

function inicializarBanco() {
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
            status TEXT,
            mercadopago_id TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS configuracoes (
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
        )`);

        db.get(`SELECT * FROM configuracoes LIMIT 1`, (err, row) => {
            if (!row) {
                db.run(`INSERT INTO configuracoes(public_key, access_token, chave_pix, nome_recebedor, ambiente)
                        VALUES('', '', '', '', 'sandbox')`);
            }
        });
    });
}

// Funções auxiliares
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

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// Rotas de Produtos
app.get('/api/produtos', (req, res) => {
    db.all('SELECT * FROM produtos ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json((rows || []).map(normalizarProduto));
    });
});

app.get('/api/produtos/:id', (req, res) => {
    db.get('SELECT * FROM produtos WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        if (!row) return res.status(404).json({ erro: 'Produto nao encontrado.' });
        res.json(normalizarProduto(row));
    });
});

app.post('/api/produtos', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    const dados = req.body;
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
            if (err) return res.status(500).json({ erro: 'Erro ao gravar o produto.' });
            res.status(201).json({ sucesso: true, id: this.lastID });
        }
    );
});

app.put('/api/produtos/:id', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    const dados = req.body;
    const novasFotos = salvarFotosBase64(dados.fotosBase64);
    const fotosExistentes = Array.isArray(dados.fotosExistentes) ? dados.fotosExistentes : [];
    const fotosFinais = novasFotos.length ? [...fotosExistentes, ...novasFotos] : fotosExistentes;

    db.run(
        `UPDATE produtos SET nome = ?, preco = ?, descricao = ?, sobre = ?, informacoes = ?, foto = ?, max_parcelas = ?, juros_mensal = ? WHERE id = ?`,
        [
            dados.nome,
            Number(dados.preco || 0),
            dados.descricao || '',
            dados.sobre || '',
            dados.informacoes || '',
            JSON.stringify(fotosFinais.length ? fotosFinais : ['https://via.placeholder.com/450?text=Core+Case']),
            Number(dados.max_parcelas || 12),
            Number(dados.juros_mensal || 0),
            req.params.id
        ],
        function (err) {
            if (err) return res.status(500).json({ erro: 'Erro ao atualizar o produto.' });
            res.json({ sucesso: this.changes > 0 });
        }
    );
});

app.delete('/api/produtos/:id', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    db.run('DELETE FROM produtos WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: 'Erro ao excluir o produto.' });
        res.json({ sucesso: this.changes > 0 });
    });
});

// Rotas de Usuários
app.post('/api/cadastro', (req, res) => {
    const dados = req.body;
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
            if (err) return res.status(400).json({ erro: 'CPF ou e-mail ja cadastrados.' });
            res.status(201).json({ sucesso: true, id: this.lastID });
        }
    );
});

app.post('/api/login', (req, res) => {
    const dados = req.body;
    const login = String(dados.email || '').trim();
    const senha = String(dados.senha || '');

    if (login === 'admin' && senha === 'System') {
        return res.json({
            sucesso: true,
            usuario: { id: 0, nome: 'Administrador', email: 'admin', is_admin: 1 },
            adminToken: ADMIN_TOKEN
        });
    }

    db.get(`SELECT * FROM usuarios WHERE email = ?`, [login], (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        if (!row || !senhaConfere(senha, row.senha)) {
            return res.status(401).json({ sucesso: false, erro: 'Login ou senha incorretos.' });
        }

        if (!String(row.senha || '').startsWith('pbkdf2:')) {
            db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [criarHashSenha(senha), row.id]);
        }

        delete row.senha;
        res.json({
            sucesso: true,
            usuario: row,
            adminToken: Number(row.is_admin) === 1 ? ADMIN_TOKEN : null
        });
    });
});

app.get('/api/usuarios', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    db.all(
        `SELECT id, nome, cpf, cep, endereco, telefone, email, foto, is_admin FROM usuarios ORDER BY id DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ erro: err.message });
            res.json(rows || []);
        }
    );
});

app.put('/api/usuarios/:id', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    const dados = req.body;
    db.run('UPDATE usuarios SET is_admin = ? WHERE id = ?', [dados.is_admin ? 1 : 0, req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: 'Erro ao atualizar usuario.' });
        res.json({ sucesso: this.changes > 0 });
    });
});

// Rotas de Configurações
app.get('/api/configuracoes', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    db.get('SELECT * FROM configuracoes LIMIT 1', [], (err, row) => {
        if (err) return res.status(500).json({ erro: 'Erro ao carregar configuracoes.' });
        res.json(row || {});
    });
});

app.put('/api/configuracoes', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    const dados = req.body;
    db.run(
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
        ],
        function(err) {
            if (err) return res.status(500).json({ erro: 'Erro ao salvar configuracoes.' });
            res.json({ sucesso: true });
        }
    );
});

// Rota de Checkout
app.post('/api/checkout', async (req, res) => {
    try {
        const dados = req.body;
        const codigoPedido = Math.floor(100000 + Math.random() * 900000);

        // Adiciona a URL do webhook dinamicamente
        dados.notificationUrl = `${process.env.URL || 'https://seu-site.netlify.app'}/api/webhook`;

        const mpResponse = await mpService.criarPagamento(db, dados, codigoPedido);
        const mpId = mpResponse ? String(mpResponse.id) : null;
        const statusInicial = dados.formaPagamento === 'pix' ? 'Pendente' : 'Em Processamento';

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
                if (err) return res.status(500).json({ erro: 'Erro ao gravar o pedido no banco de dados local.' });

                const resposta = {
                    sucesso: true,
                    codigo: codigoPedido,
                    id: this.lastID,
                    status: statusInicial
                };

                if (dados.formaPagamento === 'pix' && mpResponse.point_of_interaction) {
                    resposta.qr_code = mpResponse.point_of_interaction.transaction_data.qr_code;
                    resposta.qr_code_base64 = mpResponse.point_of_interaction.transaction_data.qr_code_base64;
                }

                res.json(resposta);
            }
        );
    } catch (error) {
        console.error('Falha no processamento do Mercado Pago:', error.message);
        res.status(400).json({ erro: 'Não foi possível processar o pagamento.', detalhes: error.message });
    }
});

// Webhook do Mercado Pago
app.post('/api/webhook', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.query.id || req.body?.data?.id;

        if (paymentId) {
            const paymentInstance = await mpService.inicializarMercadoPago(db);
            const paymentInfo = await paymentInstance.get({ id: paymentId });
            const statusMP = paymentInfo.status;

            let statusSistema = 'Pendente';
            if (statusMP === 'approved') statusSistema = 'Aprovado (Pronto para Envio)';
            if (statusMP === 'rejected') statusSistema = 'Cancelado / Recusado';

            db.run(
                `UPDATE pedidos SET status = ? WHERE mercadopago_id = ?`,
                [statusSistema, String(paymentId)],
                (err) => {
                    if (!err) console.log(`[Webhook] Pedido MP #${paymentId} atualizado para: ${statusSistema}`);
                }
            );
        }

        res.status(200).send('OK');
    } catch (e) {
        console.error('[Webhook Error]:', e.message);
        res.status(200).send('Erro processado');
    }
});

// Rotas de Pedidos
app.get('/api/pedidos', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    db.all(
        `SELECT pedidos.*, usuarios.nome as cliente_nome, usuarios.telefone, usuarios.cpf, usuarios.email, usuarios.cep, usuarios.endereco
         FROM pedidos LEFT JOIN usuarios ON pedidos.cliente_id = usuarios.id ORDER BY pedidos.id DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ erro: err.message });
            const pedidos = (rows || []).map(row => {
                let produtos = [];
                try {
                    produtos = JSON.parse(row.produtos_json || '[]');
                } catch (e) {
                    produtos = [];
                }
                return { ...row, produtos };
            });
            res.json(pedidos);
        }
    );
});

app.put('/api/pedidos/finalizar/:id', (req, res) => {
    if (!temAcessoAdmin(req)) return res.status(403).json({ erro: 'Acesso administrativo necessario.' });
    
    db.run(`UPDATE pedidos SET status = 'Finalizado (Entregue)' WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ sucesso: false });
        res.json({ sucesso: this.changes > 0 });
    });
});

// Rota para servir uploads
app.get('/uploads/:filename', (req, res) => {
    const caminhoFoto = path.join(pastaUploads, req.params.filename);
    
    if (!fs.existsSync(caminhoFoto)) {
        return res.status(404).send('Arquivo não encontrado');
    }
    
    res.sendFile(caminhoFoto);
});

module.exports.handler = serverless(app);
