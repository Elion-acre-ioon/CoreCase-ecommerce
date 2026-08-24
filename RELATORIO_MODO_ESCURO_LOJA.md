# Relatório — Modo Escuro da Loja Pública Core Case

Data da revisão: 24/08/2026

## Resultado

Foi adicionado um modo escuro opcional exclusivamente à loja pública. O modo claro continua sendo o padrão para visitantes e para contas sem preferência salva. O painel administrativo não recebeu scripts, estilos ou controles de tema.

## Persistência e fonte de verdade

- A preferência fica na coluna `usuarios.theme`, com valor padrão `light`.
- A migração foi elevada para a versão 6 e adiciona a coluna de forma idempotente.
- O backend aceita somente `light` ou `dark` ao salvar o perfil do próprio cliente.
- Login tradicional, login Google e restauração de sessão devolvem a preferência normalizada pelo servidor.
- O cache local guarda somente o tema e o identificador da conta para evitar clarão na abertura da página.
- Após a página carregar, a sessão do servidor confirma a preferência e corrige qualquer cache desatualizado.
- Visitantes sempre recebem o modo claro. Logout e sessão expirada removem o cache do tema.
- A troca de conta ignora cache pertencente a outro usuário.

## Interface

O seletor Claro/Escuro foi incluído em `cliente-config.html`. A escolha muda a aparência imediatamente para pré-visualização e só passa a ser persistente depois que o servidor confirma o salvamento.

Uma camada central em `tema.css`, ativada por `html[data-theme="dark"]`, cobre:

- cabeçalho, navegação, menus e rodapés;
- Home, vitrine, categorias, busca, filtros e cards;
- produto, galeria, variantes, quantidade, informações e avaliações;
- carrinho e seus controles;
- checkout, formulários, preenchimento automático e modal Pix;
- histórico, estados de pedido e reembolso;
- configurações da conta, menus, superfícies e campos.

Imagens de produto, banners, logotipos, avatares e QR Code não recebem inversão, brilho artificial ou qualquer filtro de cor. Seus recipientes mantêm fundo claro quando isso melhora a leitura da imagem.

## Proteção contra clarão inicial

`tema.js` é carregado de forma síncrona antes dos estilos das páginas públicas principais. Esse pequeno bootstrap não faz requisições de rede: ele usa apenas o cache vinculado à conta atual para aplicar o atributo de tema antes da primeira pintura.

## Compatibilidade e isolamento

- Nenhuma página `admin*.html` referencia `tema.js` ou `tema.css`.
- Nenhum endpoint administrativo foi alterado.
- Carrinho, checkout, pedidos, pagamentos, reembolsos, avaliações e catálogo preservam seus fluxos existentes.
- O tema não usa a preferência do sistema operacional e não ativa modo escuro para visitantes.
- O comportamento foi conferido nas larguras de 390 px, 430 px e 768 px, nos modos claro e escuro, sem estouro horizontal observado.

## Validações

- `npm test`: aprovado, 39 testes.
- `node --check api.js`: aprovado.
- `node --check public/tema.js`: aprovado.
- `node --check public/usuario.js`: aprovado.
- `git diff --check`: aprovado.
- Revisão visual local: aprovada para Home, vitrine e estados públicos de produto nas larguras de 390 px, 430 px e 768 px.
- Segurança: a execução normal de `npm run security:check` encontra a exclusão preexistente de `bom dia.md` e para com `ENOENT`. A alteração do usuário foi preservada. O mesmo verificador aprovou os 83 arquivos rastreados presentes usando um índice temporário que apenas omitiu o arquivo já ausente, e os três arquivos novos também foram verificados separadamente sem referências sensíveis.

## Observações operacionais

- Não houve commit, push, deploy, mudança de variáveis de ambiente ou acesso ao banco de produção.
- A coluna nova será criada pela migração normal da aplicação na próxima inicialização em um ambiente configurado.
