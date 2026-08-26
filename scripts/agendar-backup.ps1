<#
    Liga a cópia semanal automática do banco do RS Pratas.

    Rode UMA vez, num PowerShell aberto como administrador:

        powershell -ExecutionPolicy Bypass -File scripts\agendar-backup.ps1

    Para desligar depois:

        powershell -ExecutionPolicy Bypass -File scripts\agendar-backup.ps1 -Remover

    Por que aqui e não no servidor: a hospedagem gratuita não guarda arquivo —
    o que ela grava some na próxima publicação. A cópia precisa ficar num lugar
    que não seja o próprio servidor que ela existe para substituir. A pasta
    backups\ fica dentro do OneDrive, então cada cópia sobe para a nuvem
    sozinha: o notebook pode queimar que o histórico continua existindo.

    A tarefa roda domingo às 20h. Se o notebook estiver desligado na hora, ela
    roda assim que ele ligar — a semana de um comércio não espera o computador.
#>

param(
    [switch]$Remover
)

$ErrorActionPreference = "Stop"

$NOME = "RS Pratas - copia semanal do banco"
$projeto = Split-Path -Parent $PSScriptRoot

if ($Remover) {
    if (Get-ScheduledTask -TaskName $NOME -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
        Write-Host "Copia semanal desligada."
    } else {
        Write-Host "Nao havia copia semanal ligada."
    }
    return
}

# Sem a conexao gravada a tarefa dispararia toda semana e falharia calada, que
# e a pior forma de nao ter backup: a de quem acha que tem.
$conexao = Join-Path $projeto ".env.backup"
if (-not (Test-Path $conexao)) {
    Write-Error @"
Falta o arquivo .env.backup com a conexao do banco.

Crie-o na pasta do projeto com uma linha so:
  DATABASE_URL=postgresql://usuario:senha@host:5432/banco

A conexao esta no painel do Render, no banco, em "External Database URL".
Esse arquivo nao vai para o GitHub - o .gitignore ja cuida disso.
"@
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "Nao achei o Node.js instalado. Instale em https://nodejs.org e rode este script de novo."
}

$semanal = Join-Path $PSScriptRoot "backup-semanal.ps1"

# O registro fica junto das copias: quem for conferir se o backup rodou vai
# olhar a pasta de backups, nao os logs do Windows.
$registro = Join-Path $projeto "backups\registro.txt"
$semanalArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$semanal`""

$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $semanalArgs -WorkingDirectory $projeto

$gatilho = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 20:00

# StartWhenAvailable: o notebook do dono nao fica ligado domingo a noite.
# WakeToRun ligado nao adianta em maquina desligada, mas resolve a suspensa.
$config = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $NOME -Action $acao -Trigger $gatilho -Settings $config `
    -Description "Copia o banco do RS Pratas para a pasta backups\, que sincroniza com o OneDrive. Mantem as 14 copias mais recentes." `
    -Force | Out-Null

Write-Host ""
Write-Host "Copia semanal ligada." -ForegroundColor Green
Write-Host "  quando: todo domingo as 20h (ou assim que o notebook ligar, se estiver desligado)"
Write-Host "  onde:   $projeto\backups"
Write-Host "  registro: $registro"
Write-Host ""
Write-Host "Para conferir agora, sem esperar domingo:"
Write-Host "  Start-ScheduledTask -TaskName '$NOME'"
