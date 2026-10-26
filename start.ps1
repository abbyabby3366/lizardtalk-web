<#
.SYNOPSIS
    LizardTalk Web - Root Startup & Concurrent Hot-Reload Launcher
.DESCRIPTION
    Validates Node.js runtime, environment variables (.env), installed dependencies,
    and conducts pre-flight TCP connectivity checks against the primary MTProto proxy
    (54.255.212.228:443) before launching both backend and frontend concurrently.
.PARAMETER DryRun
    Runs all pre-flight checks and validations without starting dev servers.
.PARAMETER CheckOnly
    Alias for DryRun.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "              LIZARDTALK WEB - STARTUP LAUNCHER                         " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. Node.js (>=20) & npm Availability Check
# -----------------------------------------------------------------------------
Write-Host "`n[1/5] Checking Node.js and npm runtime..." -ForegroundColor Yellow

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js is not found in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js (version 20 or higher) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

$nodeVersionRaw = (node -v).Trim()
if ($nodeVersionRaw -match '^v(\d+)\.') {
    $majorVersion = [int]$matches[1]
    if ($majorVersion -lt 20) {
        Write-Host "[ERROR] Node.js version $nodeVersionRaw is unsupported. LizardTalk requires Node.js >= 20.0.0." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Node.js version: $nodeVersionRaw (>= 20 requirement satisfied)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Unable to parse Node.js version string '$nodeVersionRaw'." -ForegroundColor Yellow
}

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Host "[ERROR] npm is not found in PATH." -ForegroundColor Red
    exit 1
}
$npmVersion = (npm -v).Trim()
Write-Host "  [OK] npm version: $npmVersion" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Environment (.env) Validation
# -----------------------------------------------------------------------------
Write-Host "`n[2/5] Validating environment configurations (.env)..." -ForegroundColor Yellow

$rootDir = $PSScriptRoot
if (-not $rootDir) {
    $rootDir = (Get-Item .).FullName
}

$rootEnvPath = Join-Path $rootDir ".env"
$backendEnvPath = Join-Path $rootDir "backend\.env"

$defaultEnvContent = @"
TELEGRAM_API_ID=32242400
TELEGRAM_API_HASH=ec7df2d6a2563d8e49ac2759388e9719
MTPROXY_HOST=54.255.212.228
MTPROXY_PORT=443
MTPROXY_SECRET=6c465965316ffd1afb2f0e2b3ea90a86
PORT=8081
VITE_BRIDGE_HTTP_URL=http://localhost:8081
VITE_MTPROXY_BRIDGE_URL=ws://localhost:8081/mtproxy
"@

if (-not (Test-Path $rootEnvPath)) {
    Write-Host "  [WARN] Root .env not found. Initializing from default template..." -ForegroundColor Yellow
    [System.IO.File]::WriteAllText($rootEnvPath, $defaultEnvContent)
    Write-Host "  [OK] Created root .env" -ForegroundColor Green
} else {
    Write-Host "  [OK] Root .env exists: $rootEnvPath" -ForegroundColor Green
}

# Verify required keys and values in root .env
$requiredVars = @{
    "TELEGRAM_API_ID"   = "32242400"
    "TELEGRAM_API_HASH" = "ec7df2d6a2563d8e49ac2759388e9719"
    "MTPROXY_HOST"      = "54.255.212.228"
    "MTPROXY_PORT"      = "443"
    "MTPROXY_SECRET"    = "6c465965316ffd1afb2f0e2b3ea90a86"
}

$parsedVars = @{}
$rootEnvLines = Get-Content $rootEnvPath
foreach ($line in $rootEnvLines) {
    $trimmed = $line.Trim()
    if ($trimmed -and -not $trimmed.StartsWith("#") -and $trimmed.Contains("=")) {
        $parts = $trimmed.Split("=", 2)
        $k = $parts[0].Trim()
        $v = $parts[1].Trim()
        $parsedVars[$k] = $v
    }
}

foreach ($kv in $requiredVars.GetEnumerator()) {
    $k = $kv.Key
    $expected = $kv.Value
    if (-not $parsedVars.ContainsKey($k)) {
        Write-Host "  [ERROR] Missing variable in .env: $k" -ForegroundColor Red
        exit 1
    } elseif ($parsedVars[$k] -ne $expected) {
        Write-Host "  [WARN] $k is '$($parsedVars[$k])' (expected '$expected')" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] $k = $expected" -ForegroundColor Green
    }
}

# Ensure backend/.env exists with matching proxy credentials
$backendEnvContent = @"
PORT=8081
MTPROXY_HOST=54.255.212.228
MTPROXY_PORT=443
MTPROXY_SECRET=6c465965316ffd1afb2f0e2b3ea90a86
"@

if (-not (Test-Path $backendEnvPath)) {
    Write-Host "  [WARN] backend/.env not found. Creating with proxy credentials..." -ForegroundColor Yellow
    [System.IO.File]::WriteAllText($backendEnvPath, $backendEnvContent)
    Write-Host "  [OK] Created backend/.env" -ForegroundColor Green
} else {
    Write-Host "  [OK] backend/.env exists" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 3. Dependency Validation (node_modules Check)
# -----------------------------------------------------------------------------
Write-Host "`n[3/5] Validating dependencies (node_modules)..." -ForegroundColor Yellow

$rootNodeModules = Join-Path $rootDir "node_modules"
if (-not (Test-Path $rootNodeModules)) {
    Write-Host "  [WARN] Root node_modules not found. Executing 'npm install'..." -ForegroundColor Yellow
    Push-Location $rootDir
    try {
        npm install
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed with exit code $LASTEXITCODE." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Root dependencies installed successfully." -ForegroundColor Green
} else {
    Write-Host "  [OK] Root node_modules exists." -ForegroundColor Green
}

$backendNodeModules = Join-Path $rootDir "backend\node_modules"
if (-not (Test-Path $backendNodeModules)) {
    Write-Host "  [WARN] Backend node_modules not found. Executing 'npm --prefix backend install'..." -ForegroundColor Yellow
    npm --prefix backend install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm --prefix backend install failed with exit code $LASTEXITCODE." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Backend dependencies installed successfully." -ForegroundColor Green
} else {
    Write-Host "  [OK] Backend node_modules exists." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 4. Pre-Flight TCP Connectivity Check to Primary MTProxy (54.255.212.228:443)
# -----------------------------------------------------------------------------
Write-Host "`n[4/5] Pre-flight TCP connectivity check to primary MTProxy..." -ForegroundColor Yellow

$proxyHost = "54.255.212.228"
$proxyPort = 443
$timeoutMs = 4000
$tcpConnected = $false
$elapsedMs = 0

try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $connectAsync = $tcpClient.BeginConnect($proxyHost, $proxyPort, $null, $null)
    $success = $connectAsync.AsyncWaitHandle.WaitOne($timeoutMs, $false)
    $stopwatch.Stop()
    $elapsedMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds)

    if ($success -and $tcpClient.Connected) {
        $tcpClient.EndConnect($connectAsync)
        $tcpConnected = $true
    }
    $tcpClient.Close()
} catch {
    $tcpConnected = $false
}

$targetEndpoint = "$proxyHost" + ":" + "$proxyPort"
if ($tcpConnected) {
    Write-Host "  [OK] Connected to primary MTProxy ($targetEndpoint) in ${elapsedMs}ms!" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Connection to primary MTProxy ($targetEndpoint) timed out or unreachable." -ForegroundColor Yellow
    Write-Host "  [INFO] Fallback proxy pool will be utilized automatically by LizardTalk bridge." -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# 5. Service Configuration & Concurrent Dev Launch
# -----------------------------------------------------------------------------
Write-Host "`n[5/5] Ready to launch LizardTalk Web!" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  LizardTalk Web Dev Server Environment" -ForegroundColor Green
Write-Host "  --------------------------------------------------" -ForegroundColor DarkCyan
Write-Host "  Frontend: http://localhost:8293" -ForegroundColor White
Write-Host "  Backend:  http://localhost:8081 (ws://localhost:8081/mtproxy)" -ForegroundColor White
Write-Host "  Primary:  54.255.212.228:443" -ForegroundColor White
Write-Host "  Mode:     Concurrent Hot-Reload (backend tsx watch + frontend Vite HMR)" -ForegroundColor Gray
Write-Host "========================================================================" -ForegroundColor Cyan

if ($DryRun -or $CheckOnly) {
    Write-Host "[INFO] DryRun/CheckOnly flag specified. All pre-flight validations passed. Skipping launch." -ForegroundColor Yellow
    exit 0
}

Write-Host "Starting concurrent dev servers with hot-reload via 'npm run dev'..." -ForegroundColor Cyan
npm run dev
