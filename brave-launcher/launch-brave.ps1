<#
.SYNOPSIS
    Launches Brave Browser with remote debugging enabled on port 9222.
.PARAMETER UseSeparateProfile
    If specified, launches a separate Brave agent profile without closing your existing Brave windows.
.PARAMETER ForceRestart
    Automatically restarts Brave with debugging enabled without prompting.
#>

param (
    [switch]$UseSeparateProfile,
    [switch]$ForceRestart
)

$BraveExe = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
$Port = 9222

if (-not (Test-Path $BraveExe)) {
    $AltBrave = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
    $AltBrave86 = "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"
    if (Test-Path $AltBrave) {
        $BraveExe = $AltBrave
    } elseif (Test-Path $AltBrave86) {
        $BraveExe = $AltBrave86
    } else {
        Write-Error "Could not find brave.exe at standard locations."
        exit 1
    }
}

# Test if port 9222 is already active
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Brave CDP is ALREADY active on port $Port!" -ForegroundColor Green
    Write-Host "Browser: $($res.Browser)" -ForegroundColor Cyan
    exit 0
} catch {
    # Port is not active yet
}

$BraveProcesses = Get-Process -Name "brave" -ErrorAction SilentlyContinue

$ArtifactsDownloadDir = Join-Path $PSScriptRoot "..\artifacts\downloads\raw"
if (-not (Test-Path $ArtifactsDownloadDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDownloadDir -Force | Out-Null
}

if ($UseSeparateProfile) {
    $UserData = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\AgentProfile"
    Write-Host "🚀 Launching Brave with dedicated Agent Profile on port $Port (your existing Brave remains open)..." -ForegroundColor Cyan
    $ArgsStr = "--remote-debugging-port=$Port --remote-allow-origins=* `"--user-data-dir=$UserData`" `"--default-download-directory=$ArtifactsDownloadDir`" --no-first-run --no-default-browser-check"
    Start-Process -FilePath $BraveExe -ArgumentList $ArgsStr
} else {
    $UserData = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"

    if ($BraveProcesses) {
        Write-Host "⚠️ Brave is currently running without remote debugging." -ForegroundColor Yellow
        Write-Host "To attach CDP to your PERSONAL profile (with all your logins, cookies & extensions):"
        Write-Host "1. Press 'R' to Restart Brave with debugging (tabs will restore automatically)"
        Write-Host "2. Press 'S' to launch a Separate Agent Profile without closing current Brave"
        Write-Host "3. Press 'Q' to Quit"
        
        if ($ForceRestart) {
            $Choice = 'R'
        } else {
            $Choice = Read-Host "Enter choice [R/S/Q]"
        }

        if ($Choice -match '^[Rr]') {
            Write-Host "Closing running Brave processes..." -ForegroundColor Yellow
            $BraveProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
            $BraveProcesses | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            Write-Host "🚀 Relaunching your personal Brave profile with port $Port..." -ForegroundColor Cyan
            $ArgsStr = "--remote-debugging-port=$Port --remote-allow-origins=* `"--user-data-dir=$UserData`" --restore-last-session"
            Start-Process -FilePath $BraveExe -ArgumentList $ArgsStr
        } elseif ($Choice -match '^[Ss]') {
            $UserData = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\AgentProfile"
            Write-Host "🚀 Launching separate Agent Profile on port $Port..." -ForegroundColor Cyan
            $ArgsStr = "--remote-debugging-port=$Port --remote-allow-origins=* `"--user-data-dir=$UserData`" `"--default-download-directory=$ArtifactsDownloadDir`" --no-first-run --no-default-browser-check"
            Start-Process -FilePath $BraveExe -ArgumentList $ArgsStr
        } else {
            Write-Host "Cancelled." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "🚀 Launching Brave with port $Port..." -ForegroundColor Cyan
        $ArgsStr = "--remote-debugging-port=$Port --remote-allow-origins=* `"--user-data-dir=$UserData`" --restore-last-session"
        Start-Process -FilePath $BraveExe -ArgumentList $ArgsStr
    }
}

# Wait for port to become active
$MaxRetries = 15
$Ready = $false
for ($i = 0; $i -lt $MaxRetries; $i++) {
    Start-Sleep -Milliseconds 600
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 -ErrorAction Stop
        if ($res.Browser) {
            $Ready = $true
            break
        }
    } catch {
        # continue waiting
    }
}

if ($Ready) {
    Write-Host "✅ Brave is connected and CDP is active on port $Port!" -ForegroundColor Green
} else {
    Write-Host "⚠️ Brave started. Please verify the window opened." -ForegroundColor Yellow
}
