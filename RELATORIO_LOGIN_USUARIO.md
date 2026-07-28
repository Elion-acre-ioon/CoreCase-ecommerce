# Relatório de Análise - Login de Usuário Normal

## Data: 22/07/2026
## Status: ✅ CÓDIGO CORRETO - Problema pode ser de dados ou ambiente

---

## Análise Completa do Fluxo de Login

### 1. **Frontend (login.html)**

**Código Analisado (linhas 41-64):**
```javascript
async function efetuarLogin() {
    const email = document.getElementById('loginEmail').value;
    const senha = document.getElementById('loginSenha').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
    });
    const dados = await res.json();
    if(dados.sucesso) {
        localStorage.setItem('usuario', JSON.stringify(dados.usuario));
        if (dados.adminToken) {
            localStorage.setItem('adminToken', dados.adminToken);
        } else {
            localStorage.removeItem('adminToken');
        }
        if (Number(dados.usuario.is_admin) === 1) {
            window.location.href = '/admin-loja.html';
            return;
        }
        retornarOrigem();
    } else { alert(dados.erro); }
}
```

**✅ Status:** Código correto
- Captura email e senha corretamente
- Envia requisição POST para `/api/login`
- Trata resposta de sucesso e erro adequadamente
- Redireciona admin para painel e usuário normal para origem

---

### 2. **Backend (api.js - Endpoint de Login)**

**Código Analisado (linhas 394-429):**
```javascript
if (urlParse === '/api/login' && req.method === 'POST') {
    try {
        const dados = coletarJson(corpo);
        const login = String(dados.email || '').trim();
        const senha = String(dados.senha || '');

        // Verifica se é admin master
        if (login === ADMIN_USER && senha === ADMIN_SENHA) {
            return enviarJson(res, 200, {
                sucesso: true,
                usuario: { id: 0, nome: 'Administrador', email: ADMIN_USER, is_admin: 1 },
                adminToken: ADMIN_TOKEN
            });
        }

        // Busca usuário no banco
        const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ?`, [login]);
        if (rows.length === 0 || !senhaConfere(senha, rows[0].senha)) {
            return enviarJson(res, 401, { sucesso: false, erro: 'Login ou senha incorretos.' });
        }

        const row = rows[0];
        // Migra senha antiga (texto puro) para hash seguro no primeiro login OK
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
```

**✅ Status:** Código correto
- Valida admin master primeiro
- Busca usuário no banco de dados por email
- Verifica senha usando função `senhaConfere()`
- Migra senhas antigas automaticamente
- Remove senha do objeto antes de enviar resposta
- Retorna token admin apenas se `is_admin === 1`

---

### 3. **Funções de Segurança de Senha**

**Função criarHashSenha (linhas 169-173):**
```javascript
function criarHashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(senha || ''), salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}
```

**✅ Status:** Implementação segura
- Usa PBKDF2 com 100.000 iterações
- Salt aleatório de 16 bytes
- Hash SHA-512 de 64 bytes
- Formato: `pbkdf2:salt:hash`

**Função senhaConfere (linhas 177-191):**
```javascript
function senhaConfere(senhaInformada, senhaSalva) {
    const senha = String(senhaInformada || '');
    const salva = String(senhaSalva || '');
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
```

**✅ Status:** Implementação segura
- Suporta senhas antigas em texto puro (migração automática)
- Valida formato do hash
- Usa `timingSafeEqual` para prevenir timing attacks
- Recria hash com mesmo salt e compara

---

## Possíveis Causas do Problema

### ❌ **Causa 1: Senha Cadastrada Incorretamente**

**Sintoma:** Usuário cadastra com uma senha, mas ao fazer login com a mesma senha, não funciona.

**Diagnóstico:**
1. Verificar se o cadastro está salvando a senha com hash correto
2. Verificar se há espaços em branco antes/depois da senha
3. Verificar se há problema de encoding (UTF-8)

**Como Testar:**
```sql
-- Verificar senha salva no banco
SELECT id, nome, email, senha FROM usuarios WHERE email = 'email_do_usuario@teste.com';
```

**Resultado Esperado:**
- Senha deve começar com `pbkdf2:`
- Exemplo: `pbkdf2:a1b2c3d4...:e5f6g7h8...`

---

### ❌ **Causa 2: Problema no Cadastro**

**Código de Cadastro (linhas 372-387):**
```javascript
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
```

**✅ Status:** Código correto
- Chama `criarHashSenha(dados.senha)` corretamente
- Salva hash no banco

---

### ❌ **Causa 3: Banco de Dados Não Conectado**

**Sintoma:** Erro silencioso, nenhum usuário encontrado.

**Como Testar:**
```javascript
// Adicionar log temporário no código
console.log('Buscando usuário:', login);
const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ?`, [login]);
console.log('Usuários encontrados:', rows.length);
```

---

### ❌ **Causa 4: Email com Espaços ou Case Sensitivity**

**Problema:** Email cadastrado como `Usuario@Email.com` mas login tenta `usuario@email.com`

**Solução:** Normalizar email no cadastro e login:
```javascript
const email = String(dados.email || '').trim().toLowerCase();
```

---

## Testes Recomendados

### Teste 1: Verificar Usuário no Banco
```sql
SELECT id, nome, email, LEFT(senha, 20) as senha_inicio, is_admin 
FROM usuarios 
WHERE email = 'seu_email@teste.com';
```

**Resultado Esperado:**
- Usuário existe
- `senha_inicio` começa com `pbkdf2:`
- `is_admin` é `0` para usuário normal

---

### Teste 2: Testar Login com Console do Navegador

1. Abrir DevTools (F12)
2. Ir para aba Console
3. Executar:
```javascript
fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        email: 'seu_email@teste.com', 
        senha: 'sua_senha' 
    })
})
.then(r => r.json())
.then(d => console.log('Resposta:', d))
.catch(e => console.error('Erro:', e));
```

**Resultado Esperado (Sucesso):**
```json
{
    "sucesso": true,
    "usuario": {
        "id": 1,
        "nome": "Nome do Usuario",
        "email": "seu_email@teste.com",
        "is_admin": 0,
        ...
    },
    "adminToken": null
}
```

**Resultado Esperado (Erro):**
```json
{
    "sucesso": false,
    "erro": "Login ou senha incorretos."
}
```

---

### Teste 3: Verificar Logs do Servidor

Ao tentar fazer login, verificar console do servidor para:
- Erros de conexão com banco
- Exceções não tratadas
- Mensagens de erro

---

## Correções Sugeridas (Se Necessário)

### Correção 1: Normalizar Email no Cadastro e Login

**Arquivo: api.js**

**No Cadastro (linha ~378):**
```javascript
const emailNormalizado = String(dados.email || '').trim().toLowerCase();
// Usar emailNormalizado no INSERT
```

**No Login (linha ~397):**
```javascript
const login = String(dados.email || '').trim().toLowerCase();
```

---

### Correção 2: Adicionar Logs de Debug Temporários

**Arquivo: api.js (linha ~408):**
```javascript
console.log('[DEBUG] Tentativa de login:', login);
const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ?`, [login]);
console.log('[DEBUG] Usuários encontrados:', rows.length);
if (rows.length > 0) {
    console.log('[DEBUG] Verificando senha...');
    const senhaOk = senhaConfere(senha, rows[0].senha);
    console.log('[DEBUG] Senha confere:', senhaOk);
}
```

---

## Conclusão

**✅ O código de autenticação está CORRETO e implementado de forma segura.**

O problema relatado ("reconhece que os dados estão certos mas não entra") sugere uma das seguintes situações:

1. **Senha cadastrada diferente da senha de login** (espaços, maiúsculas/minúsculas)
2. **Email com diferença de case** (Usuario@email.com vs usuario@email.com)
3. **Problema de conexão com banco de dados**
4. **Usuário não foi cadastrado corretamente** (erro silencioso no cadastro)

### Próximos Passos Recomendados:

1. ✅ Executar **Teste 1** para verificar se usuário existe no banco
2. ✅ Executar **Teste 2** no console do navegador para ver resposta exata da API
3. ✅ Verificar logs do servidor durante tentativa de login
4. ⚠️ Se necessário, aplicar **Correção 1** para normalizar emails
5. ⚠️ Se necessário, aplicar **Correção 2** para adicionar logs de debug

---

## Informações Técnicas

- **Algoritmo de Hash:** PBKDF2-SHA512
- **Iterações:** 100.000
- **Salt:** 16 bytes aleatórios
- **Formato:** `pbkdf2:salt:hash`
- **Migração Automática:** Senhas antigas em texto puro são convertidas no primeiro login bem-sucedido

---

**Nenhuma alteração de código foi feita neste relatório. Todas as sugestões são opcionais e dependem dos resultados dos testes.**
