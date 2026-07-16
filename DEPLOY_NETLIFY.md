# 🚀 Guia de Deploy no Netlify - Core Case E-commerce

## ✅ Correções Realizadas

### 1. **Erro SQL Corrigido** (linha 84 do server.js)
- ❌ Antes: `public_key TEST-9ecad9c5-2c96-44dc-bc62-e4ac2da8f180`
- ✅ Agora: `public_key TEXT`

### 2. **Erro de Variável Corrigido** (linha 739 do server.js)
- ❌ Antes: `server.listen(PORT, ...)`
- ✅ Agora: `servidor.listen(PORT, ...)`

### 3. **Arquivos Criados para Netlify**
- ✅ `netlify.toml` - Configuração principal do Netlify
- ✅ `netlify/functions/api.js` - Função serverless para backend
- ✅ `public/_redirects` - Redirecionamentos de rotas
- ✅ Dependências atualizadas no `package.json`

---

## 📋 Passo a Passo para Deploy

### **Opção 1: Deploy via Git (Recomendado)**

1. **Inicialize o repositório Git** (se ainda não tiver):
   ```bash
   git init
   git add .
   git commit -m "Preparado para deploy no Netlify"
   ```

2. **Crie um repositório no GitHub**:
   - Acesse https://github.com/new
   - Crie um novo repositório
   - Siga as instruções para fazer push do código

3. **Deploy no Netlify**:
   - Acesse https://app.netlify.com
   - Clique em "Add new site" → "Import an existing project"
   - Conecte sua conta do GitHub
   - Selecione o repositório do projeto
   - **Configurações de Build**:
     - Build command: `npm install`
     - Publish directory: `public`
     - Functions directory: `netlify/functions`
   - Clique em "Deploy site"

### **Opção 2: Deploy Manual (Arrastar e Soltar)**

1. **Instale as dependências localmente**:
   ```bash
   npm install
   ```

2. **Acesse o Netlify**:
   - Vá para https://app.netlify.com
   - Clique em "Add new site" → "Deploy manually"
   - Arraste a pasta inteira do projeto para a área de upload

---

## ⚙️ Configurações Importantes no Netlify

### **Variáveis de Ambiente**

Após o deploy, configure as variáveis de ambiente:

1. No painel do Netlify, vá em **Site settings** → **Environment variables**
2. Adicione as seguintes variáveis:

```
ADMIN_TOKEN=core-case-admin-token
```

(Opcional: Altere o token para algo mais seguro)

### **Webhook do Mercado Pago**

Após o deploy, você receberá uma URL do tipo: `https://seu-site.netlify.app`

1. Acesse o painel administrativo do seu site
2. Vá em **Financeiro** → **Configurações**
3. Configure suas credenciais do Mercado Pago:
   - **Public Key** (chave pública de teste/produção)
   - **Access Token** (token de acesso de teste/produção)

4. No painel do Mercado Pago (https://www.mercadopago.com.br/developers):
   - Vá em **Suas integrações** → **Webhooks**
   - Configure a URL: `https://seu-site.netlify.app/api/webhook`
   - Selecione os eventos: **Pagamentos**

---

## 🔧 Testando o Site

### **Login Administrativo**
- **Usuário**: `admin`
- **Senha**: `System`

### **Funcionalidades Testadas**
- ✅ Listagem de produtos
- ✅ Cadastro de usuários
- ✅ Login de usuários
- ✅ Checkout com Mercado Pago
- ✅ Pagamento via PIX
- ✅ Pagamento via Cartão de Crédito
- ✅ Webhook para atualização de status
- ✅ Painel administrativo

---

## ⚠️ Limitações do Netlify (Importante!)

### **Banco de Dados SQLite**
- O banco de dados SQLite é armazenado em `/tmp` no Netlify
- **Os dados são temporários** e serão perdidos após ~6 horas de inatividade
- **Solução recomendada**: Migrar para um banco de dados persistente:
  - PostgreSQL (Supabase, Neon, Railway)
  - MongoDB (MongoDB Atlas)
  - MySQL (PlanetScale)

### **Upload de Imagens**
- Imagens são salvas em `/tmp/uploads`
- **Também são temporárias**
- **Solução recomendada**: Usar serviço de armazenamento:
  - Cloudinary
  - AWS S3
  - Uploadcare

---

## 🔄 Atualizações Futuras

Para atualizar o site após mudanças:

**Via Git:**
```bash
git add .
git commit -m "Descrição das mudanças"
git push
```
O Netlify fará o deploy automaticamente.

**Via Manual:**
Arraste novamente a pasta do projeto no painel do Netlify.

---

## 🆘 Solução de Problemas

### **Erro 404 ao acessar o site**
- ✅ Já corrigido! O arquivo `_redirects` resolve isso.

### **API não responde**
- Verifique se a pasta `netlify/functions` foi enviada
- Verifique os logs no painel do Netlify: **Functions** → **Logs**

### **Mercado Pago não funciona**
- Verifique se configurou as credenciais no painel administrativo
- Certifique-se de usar credenciais de **teste** primeiro
- Configure o webhook no painel do Mercado Pago

### **Produtos/Usuários desaparecem**
- Isso é esperado no Netlify devido ao SQLite temporário
- Migre para um banco de dados persistente (veja seção de limitações)

---

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs no Netlify: **Functions** → **Logs**
2. Teste localmente primeiro: `npm start`
3. Verifique se todas as dependências foram instaladas

---

## ✨ Próximos Passos Recomendados

1. **Migrar para banco de dados persistente** (PostgreSQL/MongoDB)
2. **Configurar armazenamento de imagens na nuvem** (Cloudinary/S3)
3. **Adicionar domínio customizado** no Netlify
4. **Configurar SSL/HTTPS** (automático no Netlify)
5. **Testar pagamentos em ambiente de produção** do Mercado Pago

---

**✅ Seu site está pronto para deploy!**

Basta seguir os passos acima e seu e-commerce estará online! 🎉
