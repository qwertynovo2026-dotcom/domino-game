@echo off
chcp 65001 >nul
echo ==========================================
echo   Деплой Домино 71 на GitHub и Render
echo ==========================================
echo.
cd /d "%~dp0"

echo [1/3] Проверяем изменения...
git status -s

echo.
echo [2/3] Добавляем файлы и создаем коммит...
git add .
set /p commit_msg="Введите описание изменений (Enter - по умолчанию): "
if "%commit_msg%"=="" set commit_msg=Update domino game (%date% %time%)

git commit -m "%commit_msg%"

echo.
echo [3/3] Отправляем на GitHub (git push)...
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo   ГОТОВО! Изменения отправлены на GitHub.
    echo   Render автоматически обновит сайт:
    echo   https://domino-kozel.onrender.com/
    echo ==========================================
) else (
    echo.
    echo [ОШИБКА] Не удалось отправить в GitHub.
    echo Проверьте подключение к интернету или авторизацию.
)

echo.
pause
