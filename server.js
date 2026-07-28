/* ============================================================================
 * ARQUIVO: server.js
 * ----------------------------------------------------------------------------
 * Ponto de entrada para rodar o projeto LOCALMENTE (ou em qualquer host que
 * suporte um processo Node "tradicional" — Railway, Render, VPS, etc.).
 *
 * Este arquivo não tem lógica de negócio nenhuma — só sobe um servidor HTTP
 * de verdade (que fica escutando uma porta) usando o handler compartilhado
 * que está em api.js.
 *
 * Rodar: npm start   (ou: node server.js)
 * ============================================================================ */

require('dotenv').config();

const http = require('http');
const { handleRequest } = require('./api');

const PORT = process.env.PORT || 3000;

http.createServer(handleRequest).listen(PORT, () => {
    console.log(`Servidor rodando com sucesso na porta ${PORT}`);
});
