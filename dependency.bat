@echo off
cd /d "%~dp0"
title ReturnLoop dependencies

rem Run this once (start.bat calls it automatically if something is missing).

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

echo Dependencies are ready.
exit /b 0

:fail
echo.
echo Dependency setup failed. See the messages above.
pause
exit /b 1
