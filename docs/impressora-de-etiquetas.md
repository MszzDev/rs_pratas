# Impressora de etiquetas — Elgin L42PRO FULL

Como deixar uma L42PRO imprimindo as etiquetas do RS Pratas. Escrito depois de
um dia inteiro perdido nisso na primeira loja, para que as outras quatro levem
quinze minutos.

## O que torna isso difícil

A impressora precisa de **cinco** ajustes certos ao mesmo tempo, e nenhum deles
dá mensagem de erro quando está errado — ela simplesmente não imprime, ou
imprime uma etiqueta e trava com uma luz piscando. Consertar um de cada vez não
mostra progresso nenhum, o que leva a pessoa a achar que a impressora está com
defeito e a desistir.

Não está. Se o **Auto Teste** do utilitário sair impresso, o cabeçote está bom e
o resto é configuração.

## O rolo que a loja usa

Três colunas de 33 × 21 mm, o que dá **104 mm de largura** de mídia. Esse número
importa: configurar 33 mm faz a impressora imaginar só a coluna da esquerda.

O papel é **térmico direto** — marca com calor, sem fita. A fita que vem na
caixa não é usada, e é melhor tirá-la: presa no mecanismo ela trava a impressora
com o LED de ribbon piscando.

## Os cinco ajustes

### 1. Driver oficial da Elgin

Baixe o driver da L42PRO no site da Elgin. **Não** use "Generic / Text Only" — ele
manda texto puro, que impressora de etiqueta ignora.

O sistema imprime pelo diálogo de impressão, desenhando a etiqueta como imagem.
Isso é bom: não depende das fontes internas da impressora, que nessa família
costumam faltar (o comando `TEXT` do TSPL não produz saída, enquanto `BAR`
funciona).

### 2. Tirar a fita

Abra a tampa e retire os dois rolos de fita, o cheio e o vazio. Confira que não
ficou nenhum pedaço enrolado no eixo nem passando pelo cabeçote.

### 3. A impressora em térmica direta

No **L42PRO FULL Utility**, aba `Ajustes`:

| Campo | Valor |
| --- | --- |
| `MÉTODO DE IMPRESSÃO` | Térmico Direto |
| `TIPO DE ETIQUETA` | Gap (Transmissivo) |
| `TRAVA DO TIPO DE ETIQUETA` | Destravado |
| `ALTURA DA ETIQUETA` | 21 mm |

Clique em `Enviar`.

O sensor transmissivo exige um passo físico que o utilitário avisa numa caixa de
mensagem fácil de fechar sem ler: **deslize o sensor, dentro da impressora, até o
batente da extrema esquerda**. Sem isso ele não enxerga o espaço entre as
etiquetas e a impressora para depois da primeira.

Depois, na aba `Funções`, clique em `Calibrar Sensor de Etiquetas`.

### 4. O driver em térmica direta

O driver manda a configuração dele junto com cada trabalho e **vence** o que está
gravado na impressora. Ajustar só o utilitário não adianta.

Em `Preferências de impressão` → aba `Papel de etiquetas`:

| Campo | Valor |
| --- | --- |
| Método de impressão | Térmica direta |
| Tipo de mídia | Etiquetas com intervalos |
| Altura do intervalo | 3,1 mm |
| **Ação pós-impressão** | **Nenhuma** |

`Separar` faz a impressora esperar que a etiqueta seja retirada antes de imprimir
a próxima. Como não há sensor de retirada, ela espera para sempre — imprime uma e
trava.

### 5. O tamanho da etiqueta no driver

Ainda em `Preferências de impressão` → aba `Configuração de página` → `Editar`:

| Campo | Valor |
| --- | --- |
| Tipo | Etiquetas cortadas com molde |
| Largura | 104,0 mm |
| Altura | 21,0 mm |

O padrão vem `USER (70 × 40 mm)`, que imprime por cima de duas etiquetas e
desalinha tudo.

## Quando ela trava

Impressora em erro **recusa tudo que chega**, inclusive comandos do utilitário
oficial. Um trabalho enviado nesse estado some sem deixar rastro: a fila do
Windows esvazia e nada acontece.

Então, ao investigar, o primeiro passo é sempre **desligar e ligar pela chave** e
confirmar verde fixo antes de mandar qualquer coisa. Metade dos testes de um dia
inteiro foram enviados para uma impressora em erro e não significaram nada.

O que cada luz diz:

| Luz | Significa |
| --- | --- |
| Verde fixo | Pronta |
| Verde piscando | Pausada — aperte FEED uma vez para sair |
| RIBBON laranja piscando | Espera fita, ou a fita travou |
| ETIQUETA vermelho piscando | Não acha o espaço entre as etiquetas |

## Uma porta USB, um programa por vez

O utilitário da Elgin e a fila de impressão do Windows **não podem usar a porta
USB ao mesmo tempo**. Quem pegar primeiro trava o outro:

- O utilitário mostra `Falha ao abrir a porta: -311`
- A fila do Windows acumula trabalhos em `Printing, Retained`

Ao mexer no utilitário, pause ou remova a fila antes. Ao imprimir, feche o
utilitário.

## Como conferir que está tudo certo

Imprima cinco etiquetas seguidas. Uma só não prova nada — o modo de falha típico
é justamente imprimir a primeira e travar.

## O caminho direto: o sistema fala com a impressora

Tudo acima descreve a impressão pelo navegador, que funciona mas exige o driver
do Windows configurado em sincronia com o modelo. Existe um caminho melhor, e é
o preferido:

**`Configurações` → `Impressora de etiqueta` → `Rede` → o IP da impressora.**

Com isso o sistema monta a etiqueta em TSPL, na resolução exata da impressora, e
manda direto. O navegador não participa: não há diálogo, margem, escala nem
página em branco, e o driver do Windows deixa de importar.

### O endereço

A impressora da loja está em **`192.168.15.240`**, com IP fixo. A porta é a
9100, padrão de fato das térmicas.

Ela veio de fábrica em `192.168.0.35`, que é uma faixa diferente da rede da loja
— por isso não aparecia em varredura nenhuma. O ajuste fica na aba `Ethernet` do
utilitário e **exige o cabo USB conectado**, porque é por ele que o utilitário
fala com ela.

Se um dia trocarem o roteador e a rede mudar de faixa, é esse número que precisa
ser ajustado, junto com o gateway.

### As linguagens

Ela entende **TSPL, EPL e ZPL** — testado mandando as três pela rede, cada uma
marcando uma faixa em altura diferente, e as três saíram. O sistema usa TSPL.

O que ela **não** tem são as **fontes internas**: o comando `TEXT` não produz
saída nenhuma, enquanto `BAR` funciona. Por isso o sistema desenha a etiqueta
como imagem e manda os pontos prontos pelo comando `BITMAP`. Fica maior em
bytes, não depende de fonte, e garante que o que aparece na tela é o que sai no
papel.

### Uma coisa por vez

O utilitário, a fila do Windows e a rede disputam a impressora. Ao investigar,
feche o utilitário e desconecte o USB antes de testar pela rede — e vice-versa.
Impressora ocupada aceita a conexão e descarta o conteúdo em silêncio, o que
parece defeito e não é.

Depois de ligar ou de mudar o endereço, **espere ela iniciar por completo** antes
de mandar qualquer coisa. Uma checagem feita cedo demais dá "sem resposta" numa
impressora que está perfeitamente bem.
