@echo off
setlocal enabledelayedexpansion
title EsnifadorSS - generar distribuibles
cd /d "%~dp0"

echo.
echo  ==========================================================
echo    EsnifadorSS  -  portable + instalador
echo  ==========================================================
echo.

REM ---------------------------------------------------------------- requisitos
where node >nul 2>&1
if errorlevel 1 (
  echo  [X] No se encuentra Node.js en el PATH.
  echo      Instalalo desde https://nodejs.org y vuelve a ejecutar este archivo.
  goto :fin_error
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo  [X] No se encuentra Rust/cargo en el PATH.
  echo      Instalalo desde https://rustup.rs y vuelve a ejecutar este archivo.
  goto :fin_error
)

REM Se invoca el binario local en vez de "npm run" para no depender de los
REM scripts del package.json.
set "CLI=node_modules\.bin\tauri.cmd"

if not exist "%CLI%" (
  echo  [1/3] Instalando dependencias de Node...
  call npm install
  if errorlevel 1 (
    echo  [X] Fallo "npm install".
    goto :fin_error
  )
  echo.
)

REM ------------------------------------------------------------------ compilar
echo  [2/3] Compilando en modo release...
echo        La primera vez tarda varios minutos: se activan LTO y
echo        codegen-units=1 para que el ejecutable quede pequeno.
echo.

call "%CLI%" build
if errorlevel 1 (
  echo.
  echo  [X] La compilacion ha fallado. Revisa los mensajes de arriba.
  goto :fin_error
)

REM ------------------------------------------------------------------ recoger
set "REL=src-tauri\target\release"
set "OUT=deploy-hosting"

if not exist "%REL%\EsnifadorSS.exe" (
  echo  [X] No se ha generado %REL%\EsnifadorSS.exe
  goto :fin_error
)

echo.
echo  [3/3] Preparando %OUT%...

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\portable"
mkdir "%OUT%\instalador"

copy /y "%REL%\EsnifadorSS.exe" "%OUT%\portable\EsnifadorSS.exe" >nul
if errorlevel 1 goto :fin_error

if exist "%REL%\bundle\nsis\*.exe" (
  copy /y "%REL%\bundle\nsis\*.exe" "%OUT%\instalador\" >nul
) else (
  echo      [!] No se encontro el instalador NSIS; solo se copia el portable.
  rmdir /q "%OUT%\instalador" 2>nul
)

> "%OUT%\LEEME.txt" (
  echo EsnifadorSS
  echo.
  echo   portable\EsnifadorSS.exe   Se ejecuta tal cual, no instala nada.
  echo   instalador\               Instalador con accesos directos y desinstalador.
  echo.
  echo Requiere WebView2, incluido de serie en Windows 10 y 11.
)

REM --------------------------------------------------------------------- pesos
echo.
echo  ==========================================================
echo    Listo:  %OUT%
echo  ==========================================================
powershell -NoProfile -Command "Get-ChildItem '%OUT%' -Recurse -Filter *.exe | ForEach-Object { '   {0,-26} {1,7:N2} MB' -f $_.Name, ($_.Length/1MB) }"
echo.
echo    Referencia: por encima de ~20 MB algo va mal en el bundle.
echo.
start "" "%OUT%"
pause
endlocal
goto :eof

:fin_error
echo.
pause
endlocal
exit /b 1
