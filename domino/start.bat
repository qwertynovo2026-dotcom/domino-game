@echo off
cd /d "%~dp0"
echo Запуск сервера Домино 71...
if /i "%~1"=="lan" set "HOST=0.0.0.0"
if not "%~2"=="" set "PORT=%~2"
node server.js
pause
