@echo off
chcp 65001 > nul
echo ============================================================
echo   image-studio Server 启动
echo ============================================================
echo.
echo   image-studio server 将运行在 http://localhost:5181
echo   这是 GIGAB2B Web 和 image-studio 共用的 AI 后端
echo.
echo ============================================================
echo.

cd /d "%~dp0..\image-studio"
if exist "start.bat" (
    call start.bat
) else (
    echo [ERROR] 未找到 image-studio\start.bat
    pause
)
