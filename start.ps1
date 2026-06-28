<#
  GIGAB2B one-shot launcher (PowerShell).
  Solves two chronic Windows dev issues:
    1. cmd /c bat files garble CJK output when invoked from PowerShell.
    2. Flask debug=True leaves the port held by a reloader subprocess,
       so restart fails with "address already in use".

  Starts 2 services: Flask backend (5182) + Vite frontend (5173).

  Usage (from project root):
    powershell -ExecutionPolicy Bypass -File .\start.ps1
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

# --- Config -------------------------------------------------------------------
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir      = Join-Path $ProjectRoot 'web'
$Ports = @{
    'GIGAB2B backend (5182)'  = 5182
    'GIGAB2B frontend (5173)' = 5173
}

# --- Helpers ------------------------------------------------------------------
function Write-Step($m) { Write-Host '[*] ' $m -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host '[+] ' $m -ForegroundColor Green }
function Write-Warn($m) { Write-Host '[!] ' $m -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host '[-] ' $m -ForegroundColor Red }

function Test-PortListening($port) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    return $null -ne $c
}

function Wait-Port($port, $name, $timeoutSec) {
    if (-not $timeoutSec) { $timeoutSec = 30 }
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening $port) {
            Write-Ok "$name ready on port $port"
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Err "$name did not become ready within ${timeoutSec}s (port $port)"
    return $false
}

function Start-Background($file, $argString, $cwd, $name) {
    Write-Step ('starting ' + $name)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $file
    $psi.Arguments = $argString
    $psi.WorkingDirectory = $cwd
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    Write-Ok ($name + ' started (PID ' + $p.Id + ')')
    return $p
}

function Install-PythonDeps {
    $pkgs = @('flask', 'flask-cors', 'requests', 'python-dotenv', 'openpyxl', 'xlrd')
    $missing = @()
    foreach ($p in $pkgs) {
        $mod = ($p -replace '-', '_') -replace '^python_', ''
        python -c "import $mod" 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $missing += $p }
    }
    if ($missing.Count -gt 0) {
        Write-Warn ('missing python packages: ' + ($missing -join ', ') + ', installing...')
        pip install $missing | Out-Null
    } else {
        Write-Ok 'python dependencies OK'
    }
}

function Install-NpmDeps($dir, $label) {
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
        Write-Warn "$label missing node_modules, running npm install..."
        Push-Location $dir
        try { npm install | Out-Null } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "$label npm install failed" }
        Write-Ok "$label dependencies installed"
    } else {
        Write-Ok "$label node_modules OK"
    }
}

# --- Pre-flight ---------------------------------------------------------------
Write-Host ''
Write-Host '============================================================' -ForegroundColor White
Write-Host '   GIGAB2B launcher'                                                -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
Write-Host ''

$busy = @()
foreach ($kv in $Ports.GetEnumerator()) {
    if (Test-PortListening $kv.Value) { $busy += $kv.Key }
}
if ($busy.Count -gt 0) {
    Write-Warn ('these ports are already in use: ' + ($busy -join ', '))
    $ans = Read-Host 'Continue anyway? (y/N)'
    if ($ans -ne 'y' -and $ans -ne 'Y') { exit 0 }
}

# --- 1. Python deps -----------------------------------------------------------
Install-PythonDeps

# --- 2. GIGAB2B Flask backend (no debug, avoids socket leak) -------------
Install-NpmDeps $WebDir 'GIGAB2B frontend'
Start-Background 'python' 'app.py' $ProjectRoot 'GIGAB2B Flask backend'
if (-not (Wait-Port 5182 'GIGAB2B backend' 20)) { exit 1 }

# --- 3. GIGAB2B Vite frontend --------------------------------------------
Start-Background 'cmd.exe' ('/c npm run dev') $WebDir 'GIGAB2B Vite frontend'
if (-not (Wait-Port 5173 'GIGAB2B frontend' 20)) { exit 1 }

# --- 4. Health check ----------------------------------------------------------
Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '   All services ready'                                                 -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
try {
    $h = Invoke-RestMethod -Uri 'http://localhost:5182/api/health' -TimeoutSec 5
    Write-Host ('  backend status: ' + $h.status) -ForegroundColor Green
    if ($h.laozhang.configured) {
        Write-Host '  laozhang AI:   OK' -ForegroundColor Green
    } else {
        Write-Host '  laozhang AI:   not configured (set LAOZHANG_API_KEY in .env)' -ForegroundColor Yellow
    }
    if ($h.has_giga_creds)    { Write-Host '  GIGA creds:     configured' -ForegroundColor Green }
                          else { Write-Host '  GIGA creds:     missing (.env)' -ForegroundColor Yellow }
} catch {
    Write-Warn ('health check failed: ' + $_.Exception.Message)
}
Write-Host ''
Write-Host '  Frontend: http://localhost:5173' -ForegroundColor Cyan
Write-Host '  Backend:  http://localhost:5182' -ForegroundColor Cyan
Write-Host ''