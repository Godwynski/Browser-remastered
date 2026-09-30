@echo off
setlocal
set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "USER_DATA=%LOCALAPPDATA%\Microsoft\Edge\User Data"

if not exist "%EDGE_EXE%" (
    set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
if not exist "%EDGE_EXE%" (
    set "EDGE_EXE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
)

if not exist "%EDGE_EXE%" (
    echo [ERROR] Could not find msedge.exe. Please verify Microsoft Edge is installed.
    pause
    exit /b 1
)

echo ========================================================
echo  Launching Microsoft Edge with Agent Control (CDP)
echo ========================================================
echo.

:: Check if port 9222 is ALREADY active
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] Edge / Chromium CDP is ALREADY active on port 9222!
    echo No need to restart browser. Tabs and logins remain open.
    echo MCP Agent is ready to connect.
    echo ========================================================
    pause
    exit /b 0
)

echo [1/3] Closing background Edge processes (required for CDP flag)...
taskkill /f /im msedge.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] Launching Edge on port 9222 with your personal profile...
start "" "%EDGE_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%USER_DATA%" --restore-last-session

echo [3/3] Waiting for browser to initialize...
timeout /t 2 /nobreak >nul

curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo  SUCCESS: Edge is running with CDP enabled on port 9222!
    echo  Your tabs and logins are active.
    echo  Antigravity / MCP Agent is ready to control Edge.
    echo ========================================================
) else (
    echo.
    echo Edge is opening. If this is the first time, please wait a moment.
)
echo.
pause
