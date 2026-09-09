# Ajudante de impressão

Um programa pequeno que fica no computador e entrega as etiquetas direto na
impressora, sem passar pelo diálogo de impressão do Windows.

## Para que serve

O navegador não pode abrir conexão de rede numa porta como a 9100 — é proibido
por segurança, em todos eles. A única saída seria o diálogo de impressão, que
passa pelo driver do Windows.

E é ali que a loja perdeu dias: o navegador escolhe o papel, aplica margem,
escala o desenho para caber e cria páginas por conta própria; o driver
acrescenta a própria ideia de área imprimível. Nenhuma dessas decisões é deles
para tomar quando o papel tem 33 mm e vem picotado — e cada página a mais é uma
etiqueta desperdiçada.

Com o ajudante, o sistema diz a medida em milímetros e a impressora obedece.
Somem de uma vez: diálogo de impressão, margem, escala, papel do driver, cartela
exposta, offset de coluna, impressora offline e fila travada.

## Como usar

**Dê dois cliques em `iniciar-ajudante.bat`.** Uma janela preta abre e fica
aberta. É só isso.

Deixe a janela aberta enquanto for imprimir etiqueta. Fechando, o sistema volta
a imprimir pelo navegador — nada quebra, só voltam os problemas dele.

## Para subir sozinho com o Windows

Se preferir não abrir na mão toda vez:

1. Aperte **Win + R**, digite `shell:startup` e Enter
2. Uma pasta abre
3. Arraste `iniciar-ajudante.bat` para dentro dela segurando **Alt** (cria atalho)

A partir daí ele sobe junto com o computador.

## A impressora

O endereço fica em `impressora.json`, ao lado do programa:

```json
{
  "ip": "192.168.15.240",
  "porta": 9100
}
```

A da loja está em **192.168.15.240**, com IP fixo. Se um dia trocarem o roteador
e a rede mudar de faixa, é esse número que muda — aqui e na aba `Ethernet` do
utilitário da Elgin, que exige o cabo USB conectado.

A porta 9100 é o padrão de fato das impressoras térmicas; não mexa nela sem
motivo.

## Quando alguma coisa não sai

O ajudante escreve na janela o que fez. Cada etiqueta entregue vira uma linha
com a hora e o tamanho; cada falha vira uma linha com o motivo, em português.

Se disser **"a impressora não respondeu"**, ela está desligada, fora da rede, ou
o cabo de rede saiu. Se disser **"recusou a conexão"**, o endereço está errado ou
alguma outra coisa está segurando a porta — o utilitário da Elgin aberto, por
exemplo, que não divide a impressora com ninguém.

## O que ele NÃO faz

Ele não sabe o que é uma etiqueta. Não faz conta de milímetro, não conhece
modelo, não desenha nada. Quem desenha é o sistema, que tem o editor, as medidas
e a régua na tela.

Isso é de propósito: mudar o desenho da etiqueta não pede versão nova dele, e ele
não tem como estragar o que recebe.

Ele também só ouve em `127.0.0.1`, ou seja, só aceita pedido **deste
computador**. Nenhum aparelho da rede consegue mandar imprimir por ele sem passar
pelo sistema.
