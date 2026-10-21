@echo off
setlocal
set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
set "USER_DATA=%LOCALAPPDATA%\Google\Chrome\User Data"

if not exist "%CHROME_EXE%" (
    set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if not exist "%CHROME_EXE%" (
    set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if not exist "%CHROME_EXE%" (
    echo [ERROR] Could not find chrome.exe. Please verify Google Chrome is installed.
    pause
    exit /b 1
)

echo ========================================================
echo  Launching Google Chrome with Agent Control (CDP)
echo ========================================================
echo.

:: Check if port 9222 is ALREADY active
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] Chromium CDP is ALREADY active on port 9222!
    echo No need to restart browser. Tabs and logins remain open.
    echo MCP Agent is ready to connect.
    echo ========================================================
    pause
    exit /b 0
)

echo [1/3] Closing background Chrome processes (required for CDP flag)...
taskkill /f /im chrome.exe >nul 2>&1
ping -n 2 127.0.0.1 >nul

echo [2/3] Launching Chrome on port 9222 with your personal profile...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%USER_DATA%" --restore-last-session

echo [3/3] Waiting for browser to initialize...
ping -n 3 127.0.0.1 >nul

curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo  SUCCESS: Chrome is running with CDP enabled on port 9222!
    echo  Your tabs and logins are active.
    echo  Antigravity is now ready to control Chrome.
    echo ========================================================
) else (
    echo.
    echo Chrome is opening. If this is the first time, please wait a moment.
)
echo.
pause
