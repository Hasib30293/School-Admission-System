# Starts the database (Docker, or a local/portable PostgreSQL), the .NET API, and the Vite dev server.
# Usage (from the repository root):  .\dev.ps1
# Anything already listening (5432 / 8080 / 5173) is left untouched, so re-running is safe.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Test-Port([int]$port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$port, [int]$timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Wait-Url([string]$url, [int]$timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
            return $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Test-Docker {
    try {
        docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

# --- make sure the Docker daemon is up before trying to use it ---
if ((Get-Command docker -ErrorAction SilentlyContinue) -and -not (Test-Docker)) {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) {
        Write-Host 'Starting Docker Desktop...' -ForegroundColor Cyan
        Start-Process -FilePath $desktop | Out-Null
        for ($i = 0; $i -lt 60 -and -not (Test-Docker); $i++) { Start-Sleep -Seconds 2 }
    }
}

# --- locate the .NET SDK ---
$dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
if (-not $dotnet) {
    foreach ($portable in @(
        'C:\Users\USER\AppData\Local\Temp\opencode\dotnet\dotnet.exe',
        'C:\Users\USER\AppData\Local\Temp\opencode\dotnet\sdk\dotnet.exe'
    )) {
        if (Test-Path $portable) { $dotnet = $portable; break }
    }
}
if (-not $dotnet) { throw 'The .NET 8 SDK was not found. Install it (or use Docker) and try again.' }
$dotnetDir = Split-Path -Parent $dotnet

# --- database ---
if (Test-Port 5432) {
    Write-Host 'PostgreSQL already running on localhost:5432.' -ForegroundColor Cyan
} elseif (Test-Docker) {
    Write-Host 'Starting PostgreSQL container...' -ForegroundColor Cyan
    docker compose -f (Join-Path $root 'docker-compose.yml') up -d postgres
} else {
    $pgHome = 'C:\Users\USER\AppData\Local\Temp\opencode\pg\pgsql'
    $pgData = 'C:\Users\USER\AppData\Local\Temp\opencode\pgdata'
    if ((Test-Path (Join-Path $pgHome 'bin\pg_ctl.exe')) -and (Test-Path $pgData)) {
        Write-Host 'Starting local PostgreSQL...' -ForegroundColor Cyan
        & (Join-Path $pgHome 'bin\pg_ctl.exe') -D $pgData -l (Join-Path (Split-Path -Parent $pgData) 'pg-server.log') start | Out-Null
        Start-Sleep -Seconds 2
    }
}
if (-not (Wait-Port 5432 60)) {
    Write-Warning "PostgreSQL is not reachable on localhost:5432. Start it, then rerun this script."
}

# --- backend ---
if (Test-Port 8080) {
    Write-Host 'API already running on localhost:8080.' -ForegroundColor Cyan
} else {
    $conn = 'Host=localhost;Port=5432;Database=school_admission;Username=admission;Password=admission'
    $backendCmd = "set `"PATH=$dotnetDir;%PATH%`" && cd /d `"$root\backend`" && set `"ConnectionStrings__Default=$conn`" && set `"ASPNETCORE_URLS=http://localhost:8080`" && dotnet run"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $backendCmd | Out-Null
    if (-not (Wait-Url 'http://localhost:8080/health' 120)) {
        Write-Warning 'The API did not become healthy on localhost:8080. Check the API window for errors.'
    }
}

# --- frontend ---
if (Test-Port 5173) {
    Write-Host 'Frontend already running on localhost:5173.' -ForegroundColor Cyan
} else {
    $frontend = Join-Path $root 'frontend'
    $frontendCmd = if (Test-Path (Join-Path $frontend 'node_modules')) {
        "cd /d `"$frontend`" && npm run dev"
    } else {
        "cd /d `"$frontend`" && npm install && npm run dev"
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $frontendCmd | Out-Null
}

Write-Host ''
Write-Host 'Backend : http://localhost:8080' -ForegroundColor Green
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Green
Write-Host 'Log windows stay open for the API and UI. Close them (or Ctrl+C there) to stop.'
