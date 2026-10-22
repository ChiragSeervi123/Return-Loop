@echo off
cd /d "%~dp0"
title ReturnLoop launcher

rem 1. Find Python (the "python" command, or the Windows "py" launcher).
set PY=
python --version >nul 2>&1 && set PY=python
if not defined PY (py --version >nul 2>&1 && set PY=py)
if not defined PY (
    echo Python 3.10 or newer is required but was not found.
    echo Download it from https://www.python.org/downloads/
    echo and tick "Add python.exe to PATH" during install, then run this file again.
    start https://www.python.org/downloads/
    goto :fail
)

rem 2. Create a private virtual environment once, so nothing is installed globally.
if not exist .venv\Scripts\python.exe (
    echo Creating virtual environment...
    %PY% -m venv .venv || goto :fail
)

rem 3. Install the dependencies listed in requirements.txt.
echo Installing requirements...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt || goto :fail

rem 4. Create the demo database on first run.
if not exist returnloop.db (
    echo Seeding database...
    .venv\Scripts\python.exe seed.py || goto :fail
)

rem 5. Start the server and open the browser.
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
