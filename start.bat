@echo off
cd /d "%~dp0"
title ReturnLoop launcher

rem No installs here, so it starts fast. Run "pip install -r requirements.txt" once beforehand.
if not exist returnloop.db (
    echo Seeding database...
    python seed.py || goto :fail
)

echo Starting ReturnLoop on http://127.0.0.1:5000 ...
start "ReturnLoop Server" python app.py
timeout /t 2 /nobreak >nul
start http://127.0.0.1:5000
exit /b 0

:fail
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
