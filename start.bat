@echo off
title EsnifadorSS - desarrollo
cd /d "%~dp0"

where node >nul 2>&1 || (echo No se encuentra Node.js en el PATH. & pause & exit /b 1)
where cargo >nul 2>&1 || (echo No se encuentra Rust/cargo en el PATH. & pause & exit /b 1)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install || (echo Fallo npm install. & pause & exit /b 1)
)

echo Arrancando EsnifadorSS en modo desarrollo...
echo La primera compilacion tarda unos minutos.
echo.
call npm run dev
pause
