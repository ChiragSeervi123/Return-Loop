@echo off
echo Stopping ReturnLoop on port 5000...
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":5000 .*LISTENING"') do (
    taskkill /F /T /PID %%p >nul 2>&1
    set FOUND=1
)
taskkill /FI "WINDOWTITLE eq ReturnLoop Server*" /F /T >nul 2>&1
if "%FOUND%"=="1" (echo Stopped.) else (echo Server was not running.)
timeout /t 2 /nobreak >nul
