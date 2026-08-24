# Relatório — Correção do PDF binário na Netlify

Data da revisão: 24/08/2026

## Erro encontrado

O PDF do recibo era gerado, tinha uma página e estrutura PDF, mas chegava ao navegador corrompido e aparecia em branco.

## Evidência

Os arquivos afetados continham repetidamente a sequência hexadecimal `EF BF BD`, que representa o caractere Unicode de substituição `�` em UTF-8. Isso demonstrava que bytes arbitrários do stream comprimido do PDF estavam sendo tratados como texto.

## Causa raiz

O wrapper da Function utilizava `serverless-http` sem declarar `application/pdf` como conteúdo binário. Na versão instalada, `serverless-http 3.2.0`, uma resposta não identificada como binária passa por `Buffer.toString('utf8')`. Bytes inválidos para UTF-8 podem então ser substituídos por `EF BF BD`, destruindo o stream comprimido.

A tipagem e a implementação locais da versão 3.2.0 confirmam suporte oficial a `binary` como `string[]` e ao retorno Base64 com `isBase64Encoded`.

## Correção

A alteração foi feita somente no adapter `netlify/functions/api.js`:

```js
exports.handler = serverless(handleRequest, {
    binary: ['application/pdf']
});
```

O endpoint tradicional continua retornando o Buffer original com `Content-Type: application/pdf`. Não foi adicionada conversão manual para Base64 no backend ou no frontend.

A correção anterior do PDFKit permanece presente:

```toml
external_node_modules = ["pdfkit"]
```

## isBase64Encoded

Resultado real do wrapper da Netlify:

- HTTP: `200`.
- `Content-Type`: `application/pdf`.
- `isBase64Encoded`: `true`.
- Corpo decodificado: assinatura `%PDF-`.
- `Content-Length`: `1898`.
- Buffer decodificado: `1898` bytes.

## Comparação de buffers

O teste gerou o Buffer A diretamente com `gerarPdfRecibo()`, passou exatamente esse Buffer por `serverless-http` configurado como o wrapper e decodificou a resposta Base64 para o Buffer B.

```text
A.equals(B): true
```

A comparação byte a byte também comprova que não houve inserção indevida de `EF BF BD`. No PDF final usado na validação, a contagem dessa sequência foi `0`.

## Renderização

O PDF obtido depois do adapter real foi salvo como `output/pdf/recibo-validacao-binario-netlify.pdf` e renderizado com Poppler.

Resultado real:

- 1 página A4.
- Página não está em branco.
- Título `CORE CASE - RECIBO` visível.
- Pedido `TESTE-001` visível.
- Cliente `Teste` visível.
- Produto `Produto Teste` visível.
- Total `R$ 100,00` visível.
- Tabela, valores e rodapé legíveis, sem cortes ou sobreposições.

O Poppler emitiu avisos locais de fonte substituta para `Symbol` e `ArialUnicode`, mas renderizou corretamente as fontes padrão e todo o conteúdo do recibo. Esses avisos não correspondem à corrupção binária investigada.

## Extração de texto

O arquivo foi aberto com `pdfplumber`, um parser real de PDF. Foram encontrados:

- `CORE CASE`: sim.
- `TESTE-001`: sim.
- `Cliente: Teste`: sim.
- `Produto Teste`: sim.
- `R$ 100,00`: sim.

Portanto o PDF contém conteúdo textual real; não é apenas um arquivo com cabeçalho `%PDF-`.

## Teste local normal

O fluxo HTTP tradicional, sem o adapter Netlify, continua aprovado nos testes existentes:

- endpoint manual: HTTP 200 e Buffer PDF válido;
- endpoint automático: HTTP 200 e Buffer PDF válido;
- pedidos aprovados, finalizados e entregues permanecem aceitos conforme as regras atuais.

`api.js` não foi alterado nesta tarefa.

## Teste Netlify local

O handler real de `netlify/functions/api.js` foi executado localmente com um evento compatível com a Function. A resposta foi Base64, decodificada e validada conforme os resultados acima.

Também foi executado:

```text
netlify functions:build --src netlify/functions --functions .netlify/functions --debug
```

Resultado:

- build da Function aprovado;
- o wrapper empacotado contém `binary: ['application/pdf']`;
- `Helvetica.afm` continua presente no pacote externalizado do PDFKit;
- tamanho observado do ZIP: 11.678.336 bytes.

Os artefatos temporários do build e da renderização foram removidos.

## Regressões

- `public/recibos.js` continua usando `response.blob()`.
- `api.js` continua enviando o Buffer diretamente com `res.end(pdf)`.
- `Content-Length` permaneceu correto após o adapter.
- PDFKit e fontes não foram alterados.
- `netlify.toml` não foi alterado.
- Editor, layout, tags, pedidos, pagamentos, banco e Cloudinary não foram alterados.

## Arquivos alterados

- `netlify/functions/api.js` — declaração explícita de PDF binário.
- `tests/auth-regression.test.js` — teste do adapter real e comparação byte a byte.
- `RELATORIO_CORRECAO_PDF_BINARIO_NETLIFY.md` — este relatório.

Artefato de validação gerado:

- `output/pdf/recibo-validacao-binario-netlify.pdf`.

## Modo escuro

**Nenhuma funcionalidade do modo escuro foi alterada.**

## Conclusão

Considero seguro para **REVISÃO antes de produção: SIM**.

Não houve commit, push, merge ou deploy.
