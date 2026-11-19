@echo off
chcp 65001 >nul
echo ==========================================
echo   Локальный сервер Домино 71
echo ==========================================
cd /d "%~dp0\domino"
if not exist node_modules (
    echo Установка зависимостей (ws)...
    call npm install
)
echo Запуск сервера на http://localhost:3000 ...
node server.js
pause
