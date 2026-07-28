/* ============================================================================
 * ARQUIVO: netlify/functions/api.js
 * ----------------------------------------------------------------------------
 * Ponto de entrada para rodar em PRODUÇÃO na Netlify (Netlify Functions).
 *
 * CORREÇÃO (seção 10, item 3 / seção 11, item 2 da documentação —
 * "Netlify não vai funcionar como está"): antes o `netlify.toml` apontava
 * pra este arquivo, mas ele simplesmente não existia no projeto — só havia
 * o server.js, que sobe um servidor HTTP tradicional (não é compatível com
 * o modelo de function serverless da Netlify).
 *
 * Este arquivo resolve isso: ele pega o MESMO handler usado no server.js
 * (definido em api.js, na raiz do projeto) e o embrulha com a lib
 * `serverless-http`, que sabe traduzir o formato de evento da Netlify para
 * um (req, res) comum do Node.
 *
 * O `netlify.toml` já está configurado para redirecionar tudo que começa
 * com /api/* para esta function.
 * ============================================================================ */

require('dotenv').config();

const serverless = require('serverless-http');
const { handleRequest } = require('../../api');

exports.handler = serverless(handleRequest);
