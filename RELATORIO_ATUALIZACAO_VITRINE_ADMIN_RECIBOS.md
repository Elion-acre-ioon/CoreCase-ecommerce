# 1. Estado inicial encontrado

## Estado encontrado antes da alteração

- Commit inicial: `53395cb e mais uma vez`.
- O worktree já continha alterações do usuário antes da implementação: exclusão de `MIGRATIONS.md`, `README.md`, `RELATORIO_CORRECAO_CADASTRO_VARIANTES.md` e `RELATORIO_CORRECAO_VALIDACAO_ADMIN_PRODUTOS.md`; edição de `bom dia.md`; e inclusão de `$schema` em `package.json`. Essas alterações foram preservadas e não fazem parte desta entrega.
- Home/Vitrine pública: `public/index.html`, `public/home.js`, `public/home.css` e as rotas/configurações de Vitrine em `api.js`.
- Banners e categorias em destaque no Admin: `public/admin-vitrine.html`, com persistência em `configuracoes` por `api.js` e imagens pelo `imageStorage.js`.
- Produtos e categorias: `public/admin-produtos.html`, `public/admin-categorias.html`, `public/loja.html` e rotas em `api.js`.
- Cards da Loja: `public/loja.html`.
- Navegação administrativa compartilhada: `public/admin.js` e `public/admin-style.css`.
- Financeiro: `public/admin-financeiro.html`, `public/financeiro.js` e rotas de configuração em `api.js`.
- Fila e análise de pedidos: `public/admin-servicos.html`, `public/admin-analise.html`, `public/analytics.js` e rotas de pedidos/analytics em `api.js`.
- Histórico do cliente: `public/historico.html` e `/api/pedidos/cliente/:id` em `api.js`.
- Carrinho: `public/cart.html` e funções compartilhadas de `public/usuario.js`.
- Pedidos, checkout e dados de entrega: `public/checkout.html`, `api.js`, tabelas `pedidos`, `pedido_itens` e `pedido_enderecos`.
- Usuários e cabeçalho autenticado: `public/cliente-config.html`, `public/admin-usuarios.html` e `public/usuario.js`.
- Avaliações: `public/avaliacoes-ui.js`, `public/admin-comentarios.js` e rotas de comentários em `api.js`.
- Migrations/schema: sistema idempotente interno de `api.js`, com lock e `schema_migrations`.
- Upload/Cloudinary: `imageStorage.js` e rotas existentes de upload em `api.js`.
- Mercado Pago/webhook: `mercadopagoService.js` e rotas existentes em `api.js`.

# 2. Vitrine

- O carrossel usa o intervalo persistido na configuração existente da Vitrine. O backend aceita somente inteiros de 200 a 1.800.000 ms.
- A rotação sempre limpa o timer anterior antes de iniciar outro, reinicia após navegação manual e pausa em hover/foco. `prefers-reduced-motion` desativa a rotação automática.
- A legenda escura deixou de ser renderizada, sem apagar os dados antigos.
- O banner inteiro permanece como um único link válido para o produto associado; `Ver mais` é um `span` visual dentro desse mesmo link.
- Categorias usam no máximo três colunas, com largura centralizada de 960 px no desktop; o mobile mantém uma coluna.
- Foi adicionada a aba `Produtos de destaque`, com múltiplas seções persistidas, origem `Todos` ou `Categoria`, categoria real, ordem, ativação, edição e exclusão.
- A Home faz uma requisição para `/api/vitrine` e uma para `/api/loja/bootstrap`, reutilizando o mesmo catálogo em todas as seções.
- Cada seção usa trilho horizontal, até quatro cards no desktop, setas, scroll suave e swipe nativo no mobile. Categoria vazia mostra uma mensagem em vez de falhar.
- Cards mostram imagem, nome, preço efetivo/promocional e tags existentes; o card inteiro é um link para o produto.

# 3. Loja

- O card completo abre o produto por clique, Enter ou Espaço.
- Os botões `Visualizar detalhes` e `Adicionar ao carrinho` foram preservados.
- Os botões internos interrompem a propagação. O tratamento de teclado do card ignora eventos originados nos botões, portanto adicionar ao carrinho não abre o produto.

# 4. Admin

- Antes, Fila, Análise, Financeiro, Vitrine, Produtos, Categorias e Usuários apareciam isolados no cabeçalho.
- Agora a navegação compartilhada usa os grupos compactos `Operação` e `Catálogo / Loja`.
- Todas as URLs e páginas anteriores foram preservadas. Nenhuma página administrativa foi consolidada ou reescrita como um HTML único.
- O grupo atual recebe indicação visual e os menus continuam utilizáveis por teclado e em largura mobile.

# 5. Recibos

- Novo módulo Admin Only em `Financeiro > Recibos`, dividido em Editor e Gerador.
- O Editor persiste um modelo estruturado: título, logo, texto, observações, rodapé e lista ordenada de campos. Não armazena nem executa HTML ou JavaScript.
- A lista de tags permitidas é validada no servidor. Logo remoto é aceito apenas em `https://res.cloudinary.com/`, com timeout de busca.
- O modo manual possui seletores para preencher cliente e adicionar produto cadastrado. Todos os campos e a lista completa de itens permanecem editáveis.
- O modo automático lista pedidos processados, preenche cliente, endereço, pagamento, valores e todos os produtos/variantes, mantendo edição antes da geração. O servidor consulta novamente o pedido e valida o status.
- O PDF é gerado no servidor, em A4, com código do pedido, campos na ordem configurada, múltiplos itens, quantidades, variantes, valores unitários, totais e moeda BRL.
- Conteúdo é tratado como texto, com limites de tamanho; não há execução de HTML/JS. O PDF inspecionado reportou `JavaScript: no`.
- A documentação completa está em `RECIBOS_TAGS.md`.

# 6. Reembolso

- Foi criada persistência em `solicitacoes_reembolso`, com `UNIQUE` por pedido.
- O botão fica disponível somente quando o pedido pertence ao cliente, possui identificador do Mercado Pago e está em status real `Finalizado` ou `Entregue`.
- O fluxo público usa duas confirmações. Após salvar, o estado vem do banco, aparece verde, desabilitado e não duplica em um segundo POST.
- A rota usa a sessão real, valida propriedade, status e pagamento no servidor.
- **NÃO EXECUTA REFUND AUTOMÁTICO NO MERCADO PAGO.** Apenas registra a solicitação para contato administrativo.

# 7. Usuários

- O cliente pode editar o próprio nome. Backend normaliza espaços, rejeita vazio e exige de 2 a 120 caracteres.
- Após sucesso, o estado local usado pelo cabeçalho é atualizado e a tela recarrega. Falha no servidor não é mais apresentada como sucesso local.
- O cabeçalho mostra foto circular de 36x36 px e primeiro nome abaixo. Foto ausente ou quebrada usa círculo cinza-claro, preservando o dropdown.
- `Excluir conta` aplica exclusão lógica: `usuarios.ativo = 0`, incrementa a versão de sessão e revoga sessões abertas.
- Pedidos, histórico financeiro, comentários e identidades permanecem preservados. Login tradicional, Google e sessões existentes recusam contas inativas.
- A própria conta Admin autenticada no banco não pode ser desativada pela mesma sessão.

# 8. Avaliações

- Cliente e Admin podem publicar/editar avaliação com nota e texto vazio.
- Textareas deixaram de exigir texto, e o backend valida somente a nota obrigatória dentro da faixa já existente.
- Avaliações vazias não geram `<p></p>`.
- A coluna `comentarios_produto.texto` continua `TEXT NOT NULL`, pois string vazia já é válida. Nenhuma alteração de coluna foi necessária e comentários existentes são preservados.
- Cada produto ganhou flags independentes para exibir vendas/estoque e quantidade de avaliações. Os dados internos, o estoque real, o checkout e os comentários não são alterados.
- Produtos antigos recebem `DEFAULT 1`, mantendo o comportamento público anterior.

# 9. Banco

- Schema atualizado de versão 4 para 5, seguindo o mecanismo existente.
- `usuarios.ativo TINYINT(1) NOT NULL DEFAULT 1`.
- `produtos.exibir_contadores_publicos TINYINT(1) NOT NULL DEFAULT 1`.
- `produtos.exibir_avaliacoes_publicas TINYINT(1) NOT NULL DEFAULT 1`.
- `configuracoes.home_vitrine_produtos_json LONGTEXT NULL`.
- `configuracoes.home_vitrine_intervalo_ms INT NOT NULL DEFAULT 7000`.
- `configuracoes.recibo_config_json LONGTEXT NULL`.
- Nova tabela `solicitacoes_reembolso`: `pedido_id`, `usuario_id`, `status`, `solicitado_em`, índice por usuário e unicidade por pedido.
- As operações usam `CREATE TABLE IF NOT EXISTS` e verificação de coluna antes de `ALTER`. As novas colunas/tabela são verificadas antes de registrar a versão 5.
- Nenhuma migration foi executada manualmente em produção.

# 10. Arquivos modificados

- `api.js`: migrations, Vitrine, recibos/PDF, reembolso, nome, desativação, avaliações e flags públicas.
- `public/index.html`, `public/home.js`, `public/home.css`: Home, banner, categorias e carrosséis de produtos.
- `public/admin-vitrine.html`: intervalo e CRUD de seções de produtos.
- `public/loja.html`: card completo clicável com proteção dos botões.
- `public/admin.js`, `public/admin-style.css`: grupos da navegação administrativa.
- `public/admin-financeiro.html`, `public/financeiro.js`: Editor/Gerador de recibos manual e automático.
- `RECIBOS_TAGS.md`: documentação das tags e origens.
- `public/historico.html`: confirmação e estado persistido da solicitação de reembolso.
- `public/cliente-config.html`, `public/usuario.js`: edição de nome, atualização local, avatar e fallback.
- `public/admin-usuarios.html`: exclusão lógica com confirmação.
- `public/admin-produtos.html`, `public/produto.html`: controles e aplicação das flags de visibilidade.
- `public/avaliacoes-ui.js`, `public/admin-comentarios.js`: texto opcional e renderização sem parágrafo vazio.
- `tests/auth-regression.test.js`: mocks ajustados e novos testes de autoplay, recibos, PDF, reembolso, cards e avaliação sem texto.
- `package.json`, `package-lock.json`: dependência PDF específica.
- `RELATORIO_ATUALIZACAO_VITRINE_ADMIN_RECIBOS.md`: este relatório.

# 11. Dependências

- Adicionada somente `pdfkit` na versão exata `0.19.1`.
- `package-lock.json` foi atualizado apenas com `pdfkit` e suas dependências transitivas.
- Não foi executado `npm audit fix` e nenhuma outra dependência existente foi atualizada por esta tarefa.

# 12. Testes

- `node --check api.js` e checagem de todos os arquivos JavaScript externos alterados: passou, sem saída de erro.
- `npm test`: passou com **33 testes, 33 aprovados, 0 falhas**.
- Casos novos automatizados: autoplay em 200 ms, 5 s e 30 min; rejeição fora da faixa; modelo de recibo; restrição de logo/tags; PDF com múltiplos itens; elegibilidade de reembolso; proteção do botão do carrinho; duas requisições compartilhadas da Home; menus agrupados; avaliação Admin somente com nota.
- PDF de QA: arquivo A4 de uma página, código `TESTE-1234`, múltiplos itens, BRL e `JavaScript: no`; renderizado com Poppler e inspecionado visualmente após correção de alinhamento. Arquivos temporários removidos.
- `git diff --check` limitado aos arquivos desta implementação: passou.
- `npm run security:check`: não concluiu porque `MIGRATIONS.md`, `README.md`, `RELATORIO_CORRECAO_CADASTRO_VARIANTES.md` e `RELATORIO_CORRECAO_VALIDACAO_ADMIN_PRODUTOS.md` já estavam excluídos antes da tarefa. O script exige esses arquivos. Eles não foram restaurados para não sobrescrever alterações do usuário.
- `git diff --check` global: aponta espaços finais somente em `bom dia.md`, alteração também preexistente e fora do escopo.

# 13. Regressões

- A suíte existente confirmou login tradicional, senha inválida, login Google, Admin por ambiente, Admin do banco, logout cliente/Admin, sessões, autorização administrativa, cadastro idempotente de produto, preço por variante, produto por ID, Vitrine pública/Admin e comentários existentes.
- Checkout, cálculo server-side, Mercado Pago, PIX, webhook, carrinho, upload Cloudinary, tracking e sistema de variantes não tiveram sua lógica funcional alterada.
- Não houve teste real contra Mercado Pago, Google, Cloudinary ou banco MySQL de produção/homologação nesta execução local.

# 14. Pontos que exigem teste manual em produção/homologação

- Aplicar e validar a migration 5 em cópia equivalente do banco, incluindo rollback operacional/backup antes da janela de mudança.
- Conferir Home em desktop e dispositivos mobile reais: autoplay nos três intervalos, pausa, navegação, 1/2/3/4/6 categorias, múltiplas seções, categoria vazia, setas e swipe.
- Validar Loja com mouse, toque e teclado, principalmente `Adicionar ao carrinho` sem navegação.
- Validar todos os menus Admin e permissões em mobile.
- Gerar recibos manual/automático com pedidos reais de 1 e vários produtos, variantes, desconto, frete, campos ausentes e logo Cloudinary.
- Validar reembolso com pedido não pago, pago não finalizado, finalizado, pertencente a outro usuário, cancelamento das confirmações, recarga e POST repetido.
- Validar desativação de usuário comum, Google, com pedidos e sessões abertas, além da proteção do Admin atual.
- Validar avaliações com nota/texto/mídia e flags públicas em produtos antigos e novos.
- Executar regressão end-to-end de checkout, PIX, Mercado Pago e webhook no ambiente de homologação, embora esses fluxos não tenham sido modificados.

# 15. Git diff

- A implementação é incremental e concentrada nas áreas solicitadas.
- Alterações preexistentes do usuário continuam presentes e separadas: quatro documentos excluídos, `bom dia.md` editado e `$schema` em `package.json`.
- Nenhum commit, push, merge ou deploy foi realizado.

# 16. Conclusão

**Considero seguro para REVISÃO antes de produção: SIM.**

Ainda não deve ser declarado seguro para produção sem aplicar/testar a migration em ambiente equivalente e concluir os testes manuais de browser, banco, recibos com dados reais e regressão dos serviços externos.
