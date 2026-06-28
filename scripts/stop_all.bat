@echo off
REM Stop all GIGAB2B dev services (Flask + Vite)
REM 用 cmd 写以避免 PowerShell $_ 转义问题

setlocal
echo Stopping services on ports 5182, 5173...

for %%P in (5182 5173) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P.*LISTENING"') do (
        echo   killing PID %%I on port %%P
        taskkill /F /PID %%I >nul 2>&1
    )
)

REM 兜底：杀掉可能的残留 python / node 子进程
taskkill /F /IM python.exe /FI "WINDOWTITLE eq GIGAB2B*" >nul 2>&1
taskkill /F /IM node.exe /FI "WINDOWTITLE eq GIGAB2B*" >nul 2>&1

timeout /t 2 /nobreak >nul
echo Done.
endlocal