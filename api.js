/* ============================================================================
 * ARQUIVO: api.js
 * Lógica central de negócios e rotas da API.
 * Exporta a função handleRequest(req, res) para uso em server.js e Netlify.
 * ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2');

const mpService = require('./mercadopagoService');
const imageStorage = require('./imageStorage');

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

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'core-case-admin-token';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'System';

if (!process.env.ADMIN_TOKEN || !process.env.ADMIN_USER || !process.env.ADMIN_SENHA) {
    console.warn('[AVISO SEGURANÇA] Credenciais admin usando padrão de desenvolvimento. Defina as variáveis de ambiente.');
}

/* ============================================================================
 * INICIALIZAÇÃO E CRIAÇÃO DE TABELAS
 * ============================================================================ */
async function inicializarBanco() {
    try {
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
            is_admin INT DEFAULT 0
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS produtos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255),
            preco DECIMAL(10,2),
            descricao TEXT,
            sobre TEXT,
            informacoes TEXT,
            foto TEXT,
            max_parcelas INT DEFAULT 12,
            juros_mensal DECIMAL(5,2) DEFAULT 0.0
        )`);

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
            mercadopago_id VARCHAR(255)
        )`);

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
        console.log('Banco de dados MySQL mapeado e pronto.');
    } catch (err) {
        console.error('Erro na inicialização do MySQL:', err.message);
    }
}
inicializarBanco();

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
function normalizarProduto(produto) {
    return {
        ...produto,
        preco: Number(produto.preco || 0),
        max_parcelas: Number(produto.max_parcelas || 12),
        juros_mensal: Number(produto.juros_mensal || 0)
    };
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

// Verifica se o token informado no header pertence ao admin
function temAcessoAdmin(req) {
    return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

// Bloqueia acesso caso não seja admin
function exigirAcessoAdmin(req, res) {
    if (temAcessoAdmin(req)) return true;
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
        res.writeHead(200, { 'Content-Type': tipos[ext] || 'application/octet-stream' });
        res.end(content);
    });
}

/* ============================================================================
 * MANIPULADOR PRINCIPAL DE REQUISIÇÕES (API HANDLER)
 * ============================================================================ */
function handleRequest(req, res) {
    // Configurações de CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

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
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(data);
        });
        return;
    }

    let corpo = '';
    req.on('data', chunk => { corpo += chunk.toString(); });

    req.on('end', async () => {
        /* -------------------------------------------------------------------
         * ROTAS DE PRODUTOS
         * ------------------------------------------------------------------- */

        // GET /api/produtos — Listar todos os produtos
        if (urlParse === '/api/produtos' && req.method === 'GET') {
            try {
                const [rows] = await db.execute('SELECT * FROM produtos ORDER BY id DESC');
                enviarJson(res, 200, (rows || []).map(normalizarProduto));
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        // GET /api/produtos/:id — Buscar produto por ID
        if (urlParse.startsWith('/api/produtos/') && req.method === 'GET') {
            const id = urlParse.split('/').pop();
            try {
                const [rows] = await db.execute('SELECT * FROM produtos WHERE id = ?', [id]);
                if (rows.length === 0) return enviarJson(res, 404, { erro: 'Produto nao encontrado.' });
                enviarJson(res, 200, normalizarProduto(rows[0]));
            } catch (err) {
                enviarJson(res, 500, { erro: err.message });
            }
            return;
        }

        // POST /api/produtos — Cadastrar novo produto (Admin)
        if (urlParse === '/api/produtos' && req.method === 'POST') {
            if (!exigirAcessoAdmin(req, res)) return;

            try {
                const dados = coletarJson(corpo);
                const fotos = await imageStorage.salvarVariasImagensBase64(dados.fotosBase64, 'prod');
                const fotosFinais = fotos.length ? fotos : ['https://via.placeholder.com/450?text=Core+Case'];

                const [result] = await db.execute(
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
        if (urlParse.startsWith('/api/produtos/') && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;

            try {
                const id = urlParse.split('/').pop();
                const dados = coletarJson(corpo);
                const novasFotos = await imageStorage.salvarVariasImagensBase64(dados.fotosBase64, 'prod');
                const fotosExistentes = Array.isArray(dados.fotosExistentes) ? dados.fotosExistentes : [];
                const fotosFinais = novasFotos.length ? [...fotosExistentes, ...novasFotos] : fotosExistentes;

                const [result] = await db.execute(
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

        // DELETE /api/produtos/:id — Excluir produto (Admin)
        if (urlParse.startsWith('/api/produtos/') && req.method === 'DELETE') {
            if (!exigirAcessoAdmin(req, res)) return;
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

        // POST /api/login — Login de cliente e Admin
        if (urlParse === '/api/login' && req.method === 'POST') {
            try {
                const dados = coletarJson(corpo);
                const login = String(dados.email || '').trim().toLowerCase();
                const senha = String(dados.senha || '');

                // Checa se é o usuário master admin
                if (login === String(ADMIN_USER).toLowerCase() && senha === ADMIN_SENHA) {
                    return enviarJson(res, 200, {
                        sucesso: true,
                        usuario: { id: 0, nome: 'Administrador', email: ADMIN_USER, is_admin: 1 },
                        adminToken: ADMIN_TOKEN
                    });
                }

                const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ?`, [login]);
                if (rows.length === 0 || !senhaConfere(senha, rows[0].senha)) {
                    return enviarJson(res, 401, { sucesso: false, erro: 'Login ou senha incorretos.' });
                }

                const row = rows[0];
                // Atualiza senha antiga texto puro para hash
                if (!String(row.senha || '').startsWith('pbkdf2:')) {
                    await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [criarHashSenha(senha), row.id]);
                }

                delete row.senha;
                enviarJson(res, 200, {
                    sucesso: true,
                    usuario: row,
                    adminToken: Number(row.is_admin) === 1 ? ADMIN_TOKEN : null
                });
            } catch (e) {
                enviarJson(res, 400, { erro: 'Dados de login invalidos.' });
            }
            return;
        }

        // GET /api/usuarios — Listar usuários (Admin)
        if (urlParse === '/api/usuarios' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;
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
            try {
                const id = urlParse.split('/')[3];
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
            if (!exigirAcessoAdmin(req, res)) return;
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
                enviarJson(res, 200, rows[0] || {});
            } catch (err) {
                enviarJson(res, 500, { erro: 'Erro ao carregar configuracoes públicas.' });
            }
            return;
        }

        // GET /api/configuracoes — Configurações completas (Admin)
        if (urlParse === '/api/configuracoes' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;
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
            if (!exigirAcessoAdmin(req, res)) return;
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

        /* -------------------------------------------------------------------
         * PAGAMENTOS E CHECKOUT
         * ------------------------------------------------------------------- */

        // POST /api/checkout — Processar novo pedido com Mercado Pago
        if (urlParse === '/api/checkout' && req.method === 'POST') {
          try {
              const dados = coletarJson(corpo);
              const idsProdutos = (dados.produtos || []).map(p => p.id).filter(Boolean);
              if (idsProdutos.length === 0) {
                  return enviarJson(res, 400, { erro: 'O pedido não contém produtos.' });
              }

              const placeholders = idsProdutos.map(() => '?').join(',');
              const [produtosDoBanco] = await db.execute(`SELECT * FROM produtos WHERE id IN (${placeholders})`, idsProdutos);

              let totalServidor = 0;
              let maiorTaxaDeJuros = 0;

              dados.produtos.forEach(itemCarrinho => {
                  const produtoDB = produtosDoBanco.find(p => p.id === itemCarrinho.id);
                  if (produtoDB) {
                      totalServidor += (Number(produtoDB.preco) || 0) * (Number(itemCarrinho.qtd) || 1);
                      if ((Number(produtoDB.juros_mensal) || 0) > maiorTaxaDeJuros) {
                          maiorTaxaDeJuros = Number(produtoDB.juros_mensal);
                      }
                  }
              });

              if (dados.tipoPagamentoMP === 'cartao' && dados.formaPagamento === 'Credito' && maiorTaxaDeJuros > 0 && dados.installments > 1) {
                  totalServidor = totalServidor * Math.pow((1 + maiorTaxaDeJuros / 100), dados.installments);
              }

              dados.total = parseFloat(totalServidor.toFixed(2));

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
                              `INSERT INTO pedidos (codigo_pedido, cliente_id, nome_recebedor, endereco_envio, produtos_json, total, forma_pagamento, status, mercadopago_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [codigoPedido, dados.clienteId, dados.nomeRecebedor, dados.enderecoEnvio, JSON.stringify(dados.produtos || []), dados.total, dados.formaPagamento, statusInicial, mpId]
                          );

                          const resposta = { sucesso: true, codigo: codigoPedido, id: result.insertId, status: statusInicial };

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
              enviarJson(res, 400, { erro: 'Formato de requisição inválido ou erro interno.' });
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

                            await db.execute(`UPDATE pedidos SET status = ? WHERE mercadopago_id = ?`, [statusSistema, String(paymentId)]);
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

        // GET /api/pedidos — Listar pedidos para o admin
        if (urlParse === '/api/pedidos' && req.method === 'GET') {
            if (!exigirAcessoAdmin(req, res)) return;
            try {
                const [rows] = await db.execute(
                    `SELECT pedidos.*, usuarios.nome as cliente_nome, usuarios.telefone, usuarios.cpf, usuarios.email, usuarios.cep, usuarios.endereco 
                     FROM pedidos LEFT JOIN usuarios ON pedidos.cliente_id = usuarios.id ORDER BY pedidos.id DESC`
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

        // PUT /api/pedidos/finalizar/:id — Marcar pedido como entregue/finalizado
        if (urlParse.startsWith('/api/pedidos/finalizar/') && req.method === 'PUT') {
            if (!exigirAcessoAdmin(req, res)) return;
            const id = urlParse.split('/').pop();
            try {
                const [result] = await db.execute(`UPDATE pedidos SET status = 'Finalizado (Entregue)' WHERE id = ?`, [id]);
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