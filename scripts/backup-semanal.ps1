<#
    O que o Agendador de Tarefas dispara todo domingo.

    Não é para ser rodado à mão — para uma cópia agora, use
    `node scripts/backup.mjs`, que mostra o resultado na tela.

    Existe como arquivo, em vez de um comando escrito dentro da tarefa, porque
    tarefa agendada guarda o comando como uma linha só de texto: aspas dentro
    de aspas viram outra coisa no caminho, e a tarefa passa a falhar calada
    toda semana. Aqui o que roda é um arquivo, e o que se lê é o que executa.
#>

$ErrorActionPreference = "Continue"

$projeto = Split-Path -Parent $PSScriptRoot
$registro = Join-Path $projeto "backups\registro.txt"

Set-Location $projeto
New-Item -ItemType Directory -Force -Path (Join-Path $projeto "backups") | Out-Null

$quando = Get-Date -Format "yyyy-MM-dd HH:mm"
$saida = & node "scripts/backup.mjs" 2>&1
$codigo = $LASTEXITCODE

# O registro guarda o sucesso também, e não só a falha: "a última cópia foi
# domingo passado e deu certo" é a resposta que alguém vai querer no dia em que
# precisar restaurar, e ela não existe se só o erro for anotado.
$situacao = if ($codigo -eq 0) { "OK" } else { "FALHOU (codigo $codigo)" }

$texto = @(
    "[$quando] $situacao"
    ($saida | ForEach-Object { "    $_" })
    ""
) | ForEach-Object { $_ }

$texto | Out-File -FilePath $registro -Append -Encoding utf8

exit $codigo
