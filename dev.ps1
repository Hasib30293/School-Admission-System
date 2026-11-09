# Starts the database (Docker, or a local/portable PostgreSQL), the .NET API, and the Vite dev server.
# Usage (from the repository root):  .\dev.ps1
# Anything already listening (5432 / 8080 / 5173) is left untouched, so re-running is safe.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Test-Port([int]$port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
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
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
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
if (-not (Test-Port 5432)) {
    Write-Warning "PostgreSQL is not reachable on localhost:5432. Start it, then rerun this script."
}

# --- backend ---
if (Test-Port 8080) {
    Write-Host 'API already running on localhost:8080.' -ForegroundColor Cyan
} else {
    $conn = 'Host=localhost;Port=5432;Database=school_admission;Username=admission;Password=admission'
    $backendCmd = "set `"PATH=$dotnetDir;%PATH%`" && cd /d `"$root\backend`" && set `"ConnectionStrings__Default=$conn`" && set `"ASPNETCORE_URLS=http://localhost:8080`" && dotnet run"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $backendCmd | Out-Null
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
