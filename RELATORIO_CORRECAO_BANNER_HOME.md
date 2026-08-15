# Relatorio de correcao do banner da Home

## 1. Causa do corte

O Hero ja possuia as proporcoes recomendadas de `1.91 / 1` no desktop e `4 / 5` no mobile, mas a imagem ocupava toda a largura e altura do container com `object-fit: cover`. Essa combinacao ampliava e recortava a arte sempre que a proporcao real do arquivo diferia da proporcao do Hero.

## 2. Regra CSS anterior

```css
.home-banner img {
    object-fit: cover;
    object-position: center;
}
```

O fundo do Hero era `#191919`.

## 3. Regra nova

```css
.home-banner img {
    object-fit: contain;
    object-position: center;
}
```

O Hero preserva sua proporcao para evitar mudancas de altura entre slides e agora usa o fundo neutro `#f5f5f5`. Assim, eventuais areas livres ficam discretas e a arte permanece inteira, centralizada e sem deformacao.

## 4. Arquivos modificados

- `public/home.css`: exibicao integral e fundo neutro do Hero.
- `public/index.html`: atualizacao da versao do CSS para evitar cache antigo no navegador.
- `RELATORIO_CORRECAO_BANNER_HOME.md`: este relatorio.

Nenhum arquivo de API, backend, banco, upload ou administracao foi alterado.

## 5. Breakpoints verificados

- 360 px
- 390 px
- 768 px
- 1024 px
- 1366 px
- 1440 px
- 1920 px

Foram preservadas as proporcoes de `4 / 5` ate 600 px e `1.91 / 1` acima desse breakpoint. Um fixture local temporario, com artes de borda a borda nas proporcoes desktop e mobile, confirmou em todas as larguras: `object-fit: contain`, centralizacao em `50% 50%`, imagem contida no Hero e ausencia de overflow horizontal. O fixture foi removido depois do teste.

A API da instancia local estava sem destaques cadastrados. Por isso, o arquivo de producao do banner "Carregador Turbo 120W" nao estava disponivel para uma comparacao visual local; a verificacao usou artes equivalentes nas proporcoes recomendadas, incluindo marcadores em todas as bordas para detectar recorte.

## 6. Confirmacoes

- O banner desktop aparece inteiro.
- A imagem mobile especifica aparece inteira quando cadastrada.
- Sem imagem mobile, a arte desktop e reduzida proporcionalmente e aparece inteira no Hero mobile.
- A altura do Hero permanece consistente durante a rotacao do carrossel.
- Seletor, setas, swipe, pausa e rotacao automatica nao foram alterados.
- O banner inteiro continua apontando para `/produto.html?id=ID`.
- `alt`, `loading`, `fetchpriority`, `decoding` e `prefers-reduced-motion` foram preservados.
- Nenhuma API ou funcionalidade de backend foi alterada.
