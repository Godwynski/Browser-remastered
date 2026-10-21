@echo off
setlocal

:: 1. Check if port 9222 is already open
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Browser CDP is ALREADY active on port 9222.
    echo MCP Agent is ready to connect.
    exit /b 0
)

set "TARGET=%~1"
set "BROWSER_EXE="
set "USER_DATA="
set "PROC_NAME="
set "NAME="

if "%TARGET%"=="" set "TARGET=auto"

if /i "%TARGET%"=="edge" goto :try_edge
if /i "%TARGET%"=="chrome" goto :try_chrome
if /i "%TARGET%"=="brave" goto :try_brave

:try_brave
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
) else if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_EXE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
) else if exist "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_EXE=C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
)
if defined BROWSER_EXE (
    set "USER_DATA=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"
    set "PROC_NAME=brave.exe"
    set "NAME=Brave"
    goto :launch
)
if /i not "%TARGET%"=="auto" goto :not_found

:try_chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
if defined BROWSER_EXE (
    set "USER_DATA=%LOCALAPPDATA%\Google\Chrome\User Data"
    set "PROC_NAME=chrome.exe"
    set "NAME=Google Chrome"
    goto :launch
)
if /i not "%TARGET%"=="auto" goto :not_found

:try_edge
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) else if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
)
if defined BROWSER_EXE (
    set "USER_DATA=%LOCALAPPDATA%\Microsoft\Edge\User Data"
    set "PROC_NAME=msedge.exe"
    set "NAME=Microsoft Edge"
    goto :launch
)

:not_found
echo [ERROR] Could not find a supported browser (%TARGET%).
echo Supported: Brave, Google Chrome, Microsoft Edge.
pause
exit /b 1

:launch
echo ========================================================
echo  Launching %NAME% with Port 9222 (Auto-Detected)
echo ========================================================
taskkill /f /im %PROC_NAME% >nul 2>&1
ping -n 2 127.0.0.1 >nul
start "" "%BROWSER_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%USER_DATA%" --restore-last-session
ping -n 3 127.0.0.1 >nul

curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] %NAME% connected on port 9222!
) else (
    echo Browser is opening. Port 9222 will be active in a few seconds.
)
