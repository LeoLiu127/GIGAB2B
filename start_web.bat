@echo off
chcp 65001 > nul
setlocal

echo ============================================================
echo   GIGAB2B Web Application Launcher
echo ============================================================
echo.
echo   Backend:  http://localhost:5182
echo   Frontend: http://localhost:5173
echo.
echo   Prerequisites:
echo   1. Python 3.11+ and Node 18+ installed
echo   2. GIGA credentials set in .env
echo.
echo ============================================================
echo.

REM --- Check Python deps ---
python -c "import flask" 2>nul
if errorlevel 1 (
    echo [WARN] flask not installed, installing...
    pip install flask flask-cors
)
python -c "import requests" 2>nul
if errorlevel 1 (
    echo [WARN] requests not installed, installing...
    pip install requests
)
python -c "import dotenv" 2>nul
if errorlevel 1 (
    echo [WARN] python-dotenv not installed, installing...
    pip install python-dotenv
)

REM --- Check web deps ---
if not exist "web\node_modules" (
    echo [WARN] web\node_modules missing, running npm install...
    cd /d "%~dp0web"
    call npm install
    cd /d "%~dp0"
)

echo [1/2] Starting Flask backend on port 5182...
start "GIGAB2B Backend" cmd /c "cd /d %~dp0 && python app.py"

timeout /t 3 /nobreak > nul

echo [2/2] Starting frontend on port 5173...
start "GIGAB2B Frontend" cmd /c "cd /d %~dp0web && npm run dev"

echo.
echo ============================================================
echo   Launch complete!
echo   Backend:  http://localhost:5182
echo   Frontend: http://localhost:5173
echo ============================================================
echo.
echo [TIP] To stop services, close the GIGAB2B Backend/Frontend windows.
pause
