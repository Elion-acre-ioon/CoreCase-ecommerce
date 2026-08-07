const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const arquivos = execFileSync('git', ['ls-files', '-z'], {
    cwd: raiz,
    encoding: 'utf8'
}).split('\0').filter(Boolean);

const problemas = [];
const nomesSecretos = [
    'ADMIN_TOKEN',
    'ADMIN_SENHA',
    'SESSION_SECRET',
    'MYSQL_PASSWORD',
    'SMTP_PASS',
    'CLOUDINARY_API_SECRET',
    'MERCADOPAGO_ACCESS_TOKEN'
];

function registrar(arquivo, motivo) {
    problemas.push(`${arquivo}: ${motivo}`);
}

for (const arquivo of arquivos) {
    const nome = path.basename(arquivo);
    if (nome.startsWith('.env') && nome !== '.env.example') {
        registrar(arquivo, 'arquivo de ambiente esta rastreado pelo Git');
        continue;
    }

    const caminho = path.join(raiz, arquivo);
    let conteudo;
    try {
        const buffer = fs.readFileSync(caminho);
        if (buffer.includes(0)) continue;
        conteudo = buffer.toString('utf8');
    } catch (erro) {
        registrar(arquivo, `nao foi possivel auditar (${erro.code || 'erro'})`);
        continue;
    }

    if (nome === '.env.example') {
        for (const variavel of nomesSecretos) {
            const atribuicao = new RegExp(`^${variavel}=[ \\t]*[^ \\t\\r\\n]+`, 'm');
            if (atribuicao.test(conteudo)) registrar(arquivo, `${variavel} possui valor de exemplo`);
        }
    }

    if (/process\.env\.(ADMIN_TOKEN|ADMIN_SENHA|SESSION_SECRET)\s*\|\|/.test(conteudo)) {
        registrar(arquivo, 'segredo obrigatorio possui fallback');
    }
    if (/\bconst\s+(ADMIN_TOKEN|ADMIN_SENHA|SESSION_SECRET)\s*=\s*['"`][^'"`]+/.test(conteudo)) {
        registrar(arquivo, 'segredo foi definido como literal');
    }
    if (/\bSESSION_SECRET\s*=\s*[^;\n]*\bADMIN_TOKEN\b/.test(conteudo)) {
        registrar(arquivo, 'SESSION_SECRET depende de ADMIN_TOKEN');
    }
    if (/console\.(log|info|warn|error)\s*\(\s*(process\.env|ADMIN_TOKEN|ADMIN_SENHA|SESSION_SECRET)\b/.test(conteudo)) {
        registrar(arquivo, 'log pode expor segredo ou ambiente completo');
    }
    if (/JSON\.stringify\s*\(\s*process\.env\s*\)/.test(conteudo)) {
        registrar(arquivo, 'serializacao completa de process.env');
    }
    if (arquivo.toLowerCase().endsWith('.md') && /Admin emergencial:[^\n]*senha/i.test(conteudo)) {
        registrar(arquivo, 'documentacao recomenda credencial administrativa padrao');
    }

    const publico = arquivo.replace(/\\/g, '/').startsWith('public/');
    if (publico && (/\bADMIN_TOKEN\b/.test(conteudo) || /\badminToken\b/.test(conteudo) || /x-admin-token/i.test(conteudo))) {
        registrar(arquivo, 'referencia a token administrativo no frontend');
    }

    if (arquivo.replace(/\\/g, '/') === 'api.js' && /\badminToken\s*:/.test(conteudo)) {
        registrar(arquivo, 'resposta do backend pode materializar adminToken');
    }
}

if (problemas.length) {
    console.error('[security:check] FALHOU');
    for (const problema of problemas) console.error(`- ${problema}`);
    process.exit(1);
}

console.log(`[security:check] OK - ${arquivos.length} arquivos rastreados auditados.`);
