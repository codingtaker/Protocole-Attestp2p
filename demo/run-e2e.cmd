@echo off
rem Démo end-to-end sous Windows via Git Bash (pas le bash WSL).
setlocal
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Git Bash introuvable. Installez Git for Windows : https://git-scm.com/download/win
  exit /b 1
)
"%GITBASH%" "%~dp0sprint4-e2e.sh"
