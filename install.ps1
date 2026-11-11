# Antigravity Tokens HUD - Windows Installer
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       🚀 Antigravity Tokens & Performance HUD             " -ForegroundColor White -NoNewline
Write-Host " [Installer]" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Prerequisites
Write-Host "🔍 Checking environment prerequisites..." -ForegroundColor Yellow

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "❌ Error: Node.js is required but was not found in PATH." -ForegroundColor Red
    Write-Host "   Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor White
    exit 1
}

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
    Write-Host "❌ Error: Python is required but was not found in PATH." -ForegroundColor Red
    Write-Host "   Please install Python 3.9+ from https://python.org/" -ForegroundColor White
    exit 1
}

Write-Host "✅ Node.js: $($nodeCmd.Source)" -ForegroundColor Green
Write-Host "✅ Python:  $($pythonCmd.Source)" -ForegroundColor Green

# 2. Setup Target Directory
$TargetDir = "$env:USERPROFILE\.antigravity-tokens-hud"
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$ScriptDir = $PSScriptRoot
if ($ScriptDir -and (Test-Path "$ScriptDir\index.js") -and ($ScriptDir -ne $TargetDir)) {
    Write-Host "📦 Installing files from local repository to $TargetDir..." -ForegroundColor Yellow
    Copy-Item "$ScriptDir\*" $TargetDir -Recurse -Force -Exclude "stats_cache.json*", "*.log", ".git"
} elseif (-not $ScriptDir -or ($ScriptDir -ne $TargetDir)) {
    Write-Host "🌐 Downloading latest release from GitHub..." -ForegroundColor Yellow
    $RepoRaw = "https://raw.githubusercontent.com/malie2f/antigravity-tokens-hud/main"
    $Files = @("index.js", "client_widget.js", "token_stats.py", "package.json", "config.json", "uninstall.ps1")
    foreach ($file in $Files) {
        Invoke-WebRequest -Uri "$RepoRaw/$file" -OutFile "$TargetDir\$file" -UseBasicParsing
    }
}

# 3. Kill any previously running instance
Write-Host "🔄 Refreshing existing background daemon..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
    $_.Name -like "*node*" -and $_.CommandLine -like "*antigravity-tokens-hud*" 
} | ForEach-Object { 
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue 
}

# 4. Configure Silent Startup Shortcut (.vbs)
$startupFolder = [Environment]::GetFolderPath("Startup")
$vbsPath = "$startupFolder\antigravity-tokens-hud.vbs"
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""$TargetDir\index.js""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
Write-Host "✅ Configured Windows Startup auto-launch: $vbsPath" -ForegroundColor Green

# 5. Start HUD Daemon Immediately (Silent background process)
Write-Host "🚀 Launching background daemon..." -ForegroundColor Yellow
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = "wscript.exe"
$processInfo.Arguments = """$vbsPath"""
$processInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
[System.Diagnostics.Process]::Start($processInfo) | Out-Null

Start-Sleep -Seconds 1

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "✨ Antigravity Tokens HUD has been successfully installed!" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📌 What to do next:" -ForegroundColor Cyan
Write-Host "  1. Open or restart Google Antigravity." -ForegroundColor White
Write-Host "  2. Look at the bottom toolbar beside the model selector:" -ForegroundColor White
Write-Host "     [⚡ XX.X tok/s  XX.Xk/1M XX% ◯]" -ForegroundColor Green
Write-Host "  3. Click it to view the full popover with real-time speed, context caching hit rate, and 25-week activity heatmap!" -ForegroundColor White
Write-Host ""
Write-Host "🗑️ To uninstall anytime: Run $TargetDir\uninstall.ps1" -ForegroundColor Gray
Write-Host ""
