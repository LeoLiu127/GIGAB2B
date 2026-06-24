@echo off
chcp 65001 > nul
echo ============================================================
echo   GIGAB2B Web 应用启动
echo ============================================================
echo.
echo   Backend:  http://localhost:5182
echo   Frontend: http://localhost:5173
echo.
echo   前提条件：
echo   1. image-studio 项目 server.cjs 已在运行
echo      启动方式：cd ..\image-studio ^&^& start.bat
echo.
echo   2. GIGA 凭证已配置在 .env 中
echo.
echo ============================================================
echo.

:: 检查 Flask
python -c "import flask" 2>nul
if errorlevel 1 (
    echo [ERROR] Flask 未安装，正在安装...
    pip install flask flask-cors
    echo.
)

:: 检查 requests
python -c "import requests" 2>nul
if errorlevel 1 (
    echo [ERROR] requests 未安装，正在安装...
    pip install requests
    echo.
)

:: 检查 python-dotenv
python -c "import dotenv" 2>nul
if errorlevel 1 (
    echo [INFO] python-dotenv 未安装，正在安装...
    pip install python-dotenv
    echo.
)

echo [1/2] 启动 Flask 后端 (http://localhost:5182)...
start "GIGAB2B Backend" cmd /c "cd /d %~dp0 ^&^& python app.py"

timeout /t 3 /nobreak > nul

echo [2/2] 启动前端 (http://localhost:5173)...
start "GIGAB2B Frontend" cmd /c "cd /d %~dp0web ^&^& npm run dev"

echo.
echo ============================================================
echo   启动完成！
echo   后端: http://localhost:5182
echo   前端: http://localhost:5173
echo ============================================================
pause
