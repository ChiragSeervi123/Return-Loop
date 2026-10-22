@echo off
cd /d "%~dp0"
title ReturnLoop reset

echo This wipes every return, refund and uploaded photo, and puts the demo data back.
choice /m "Reset ReturnLoop now"
if errorlevel 2 exit /b 0

rem 1. Stop the server so the database file isn't in use.
if exist stop.bat call stop.bat

rem 2. Delete uploaded photos (keep the .gitkeep placeholder).
for %%f in (static\uploads\*) do if /i not "%%~nxf"==".gitkeep" del /q "%%f"

rem 3. Rebuild the database with fresh demo data.
echo Reseeding database...
if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe seed.py) else (python seed.py)
if errorlevel 1 goto :fail

rem 4. Start it again.
if exist start.bat (
    call start.bat
) else (
    echo Done. Run "python app.py" to start the server.
    pause
)
exit /b 0

:fail
echo.
echo Reset failed. See the messages above.
pause
exit /b 1
