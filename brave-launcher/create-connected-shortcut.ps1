# Creates a permanent Desktop shortcut for Brave with Port 9222 enabled
# Zero CMD needed - opening this shortcut gives Antigravity instant connection!

$WshShell = New-Object -comObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop "Brave (Antigravity).lnk"

# Search for brave.exe
$BravePaths = @(
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$TargetBrave = $null
foreach ($p in $BravePaths) {
    if (Test-Path $p) {
        $TargetBrave = $p
        break
    }
}

if (-not $TargetBrave) {
    Write-Error "Could not find brave.exe in standard locations."
    exit 1
}

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetBrave
$Shortcut.Arguments = "--remote-debugging-port=9222 --remote-allow-origins=* --restore-last-session"
$Shortcut.Description = "Launch Brave with Antigravity DevTools Connection (Port 9222)"
$Shortcut.WorkingDirectory = Split-Path $TargetBrave
$Shortcut.IconLocation = "$TargetBrave,0"
$Shortcut.Save()

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " SUCCESS: Created permanent shortcut on your Desktop:    " -ForegroundColor Green
Write-Host "   $ShortcutPath" -ForegroundColor Yellow
Write-Host " Opening Brave with this shortcut connects Antigravity    " -ForegroundColor White
Write-Host " automatically without ever needing to run a CMD command! " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
