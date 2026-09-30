@echo off
setlocal
set "BRAVE_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
set "USER_DATA=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"

if not exist "%BRAVE_EXE%" (
    set "BRAVE_EXE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
)
if not exist "%BRAVE_EXE%" (
    set "BRAVE_EXE=C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
)

echo ========================================================
echo  Launching Brave with Antigravity Agent Control (CDP)
echo ========================================================
echo.

:: Check if port 9222 is ALREADY active
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] Brave CDP is ALREADY active on port 9222!
    echo No need to restart browser. Tabs and logins remain open.
    echo Antigravity is ready to connect.
    echo ========================================================
    pause
    exit /b 0
)

echo [1/3] Closing any lingering background Brave processes...
taskkill /f /im brave.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] Launching Brave on port 9222 with your personal profile...
start "" "%BRAVE_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%USER_DATA%" --restore-last-session

echo [3/3] Waiting for browser to initialize...
timeout /t 2 /nobreak >nul

curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo  SUCCESS: Brave is running with CDP enabled on port 9222!
    echo  Your tabs and logins are active.
    echo  Antigravity is now ready to control Brave.
    echo ========================================================
) else (
    echo.
    echo Brave is opening. If this is the first time, please wait a moment.
)
echo.
pause
