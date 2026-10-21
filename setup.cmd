@echo off
setlocal
echo ========================================================
echo   Browser Agent - 1-Click Universal Setup
echo ========================================================
echo.

:: 1. Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your system PATH!
    echo Please install Node.js (version 18+) from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Install Dependencies
echo [1/2] Installing MCP dependencies...
call npm --prefix "%~dp0brave-mcp" install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install encountered an error.
    pause
    exit /b %ERRORLEVEL%
)

:: 3. Configure Antigravity MCP JSON
echo.
echo [2/2] Auto-registering MCP server in Antigravity config...
node -e "const fs=require('fs'),path=require('path'),os=require('os');const p=path.join(os.homedir(),'.gemini','config','mcp_config.json');fs.mkdirSync(path.dirname(p),{recursive:true});let c={mcpServers:{}};try{c=JSON.parse(fs.readFileSync(p,'utf8'))}catch{};c.mcpServers=c.mcpServers||{};c.mcpServers['brave-control']={command:'cmd.exe',args:['/c',path.resolve(process.argv[1])]};fs.writeFileSync(p,JSON.stringify(c,null,2),'utf8');console.log('   [OK] Registered brave-control in: ' + p);" "%~dp0brave-mcp\run-mcp.cmd"

echo.
echo ========================================================
echo   SETUP COMPLETED!
echo ========================================================
echo   To start:
echo   1. Double-click 'launch.cmd' (auto-detects Brave, Chrome, or Edge).
echo   2. Open Antigravity - your browser agent is ready!
echo ========================================================
echo.
pause
