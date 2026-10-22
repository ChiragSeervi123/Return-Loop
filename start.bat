@echo off
cd /d "%~dp0"
title ReturnLoop launcher

rem 1. Install dependencies only if they are missing (see dependency.bat).
if not exist .venv\Scripts\python.exe goto :install
.venv\Scripts\python.exe -c "import flask, flask_sqlalchemy" >nul 2>&1 && goto :ready
:install
call dependency.bat || exit /b 1

:ready
rem 2. Create the demo database on first run.
if not exist returnloop.db (
    echo Seeding database...
    .venv\Scripts\python.exe seed.py || goto :fail
)

rem 3. Start the server and open the browser.
echo Starting ReturnLoop on http://127.0.0.1:5000 ...
start "ReturnLoop Server" .venv\Scripts\python.exe app.py
timeout /t 3 /nobreak >nul
start http://127.0.0.1:5000
exit /b 0

:fail
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
