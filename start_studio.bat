@echo off
chcp 65001 > nul

echo ============================================================
echo   image-studio Server Launcher
echo ============================================================
echo.
echo   image-studio server will run on http://localhost:5181
echo   Shared AI backend for GIGAB2B Web and image-studio
echo.
echo ============================================================
echo.

cd /d "%~dp0..\image-studio"
if exist "start.bat" (
    call start.bat
) else (
    echo [ERROR] image-studio\start.bat not found
    pause
)
