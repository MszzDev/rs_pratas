@echo off
REM Inicia o ajudante de impressao da RS Pratas.
REM
REM Deixe esta janela aberta enquanto for imprimir etiqueta. Para que ele suba
REM sozinho com o Windows, veja o LEIA-ME.

title Ajudante de impressao - RS Pratas
cd /d "%~dp0"
node ajudante.mjs
pause
