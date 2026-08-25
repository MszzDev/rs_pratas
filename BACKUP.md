# Cópia de segurança

O banco guarda a venda, o caixa, o ponto oficial e a auditoria — histórico que
a loja é obrigada a manter e que não se refaz. Perder isso não é perder um
sistema; é perder o passado da empresa.

## Fazer uma cópia

```bash
node scripts/backup.mjs "postgresql://usuario:senha@host:5432/banco"
```

A conexão do banco hospedado está no painel do Render, em `rs-pratas-db` →
**Connections** → **External Database URL**.

Também funciona lendo `DATABASE_URL` do ambiente:

```bash
node scripts/backup.mjs
```

O arquivo sai em `backups/`, comprimido e com data e hora no nome. As **14
cópias mais recentes** ficam; as anteriores são removidas sozinhas.

Não precisa ter o PostgreSQL instalado: sem `pg_dump` na máquina, o script usa
um contêiner descartável do Docker.

## Conferir a última cópia

```bash
node scripts/backup.mjs --verificar
```

O script já confere o que acabou de gravar, mas isto serve para revisar uma
cópia antiga antes de confiar nela.

A conferência procura três marcas: o cabeçalho do dump, as tabelas do sistema
e a marca de conclusão no fim. Um arquivo truncado tem as duas primeiras e não
a terceira — e é justamente o caso que passaria despercebido se só olhássemos
se o arquivo existe.

## Restaurar

Testado de ponta a ponta: os dados voltam idênticos e **os gatilhos de
imutabilidade voltam junto** — o banco restaurado continua recusando alteração
em auditoria e em ponto.

```bash
# 1. Crie um banco vazio
createdb rs_pratas_restaurado

# 2. Descompacte a cópia dentro dele
gunzip -c backups/rs-pratas-2026-08-25-0907.sql.gz | psql -d rs_pratas_restaurado
```

Com Docker, sem PostgreSQL instalado:

```bash
gunzip -c backups/rs-pratas-2026-08-25-0907.sql.gz | docker exec -i rs-pratas-fase1-postgres psql -U postgres -d rs_pratas_restaurado
```

Restaure sempre num banco **novo**, nunca por cima do que está em uso. Se a
cópia estiver ruim, você descobre sem ter destruído o que ainda funcionava.

## Com que frequência

Uma vez por dia, depois do fechamento do caixa — é quando o dia está completo.

No Windows, o Agendador de Tarefas resolve: crie uma tarefa diária que execute
`node scripts/backup.mjs` na pasta do projeto, com a conexão como argumento.

## O que NÃO fazer

**Não guarde as cópias só na máquina que roda o sistema.** O caso em que o
backup importa é justamente aquele em que essa máquina se perdeu. Copie a
pasta `backups/` para um pendrive, um HD externo ou um serviço de nuvem.

**Não versione as cópias no Git.** O repositório é público, e o dump contém
dados de clientes e hashes de senha. A pasta `backups/` está no `.gitignore`
exatamente por isso.
