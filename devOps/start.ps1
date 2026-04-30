# Integrador Backend Startup Script (Windows PowerShell)
# This script starts all backend services in the correct order

param(
    [switch]$SkipDocker,
    [switch]$ApiOnly,
    [switch]$WsOnly
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Integrador Backend Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if we're in the backend directory
if (-not (Test-Path "rest_api/main.py")) {
    Write-Host "Error: Run this script from the backend directory" -ForegroundColor Red
    exit 1
}

# Step 1: Start Docker containers (PostgreSQL + Redis)
if (-not $SkipDocker) {
    Write-Host "`n[1/4] Starting Docker containers..." -ForegroundColor Yellow
    docker compose -f ../devOps/docker-compose.yml up -d

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to start Docker containers" -ForegroundColor Red
        exit 1
    }

    # Wait for services to be healthy
    Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Gray
    $maxAttempts = 30
    $attempt = 0
    do {
        $attempt++
        $result = docker compose -f ../devOps/docker-compose.yml exec -T db pg_isready -U postgres -d menu_ops 2>$null
        if ($LASTEXITCODE -eq 0) {
            break
        }
        Start-Sleep -Seconds 1
    } while ($attempt -lt $maxAttempts)

    if ($attempt -ge $maxAttempts) {
        Write-Host "Warning: PostgreSQL health check timed out" -ForegroundColor Yellow
    } else {
        Write-Host "PostgreSQL is ready!" -ForegroundColor Green
    }

    Write-Host "Waiting for Redis to be ready..." -ForegroundColor Gray
    $attempt = 0
    do {
        $attempt++
        $result = docker compose -f ../devOps/docker-compose.yml exec -T redis redis-cli ping 2>$null
        if ($result -eq "PONG") {
            break
        }
        Start-Sleep -Seconds 1
    } while ($attempt -lt $maxAttempts)

    if ($attempt -ge $maxAttempts) {
        Write-Host "Warning: Redis health check timed out" -ForegroundColor Yellow
    } else {
        Write-Host "Redis is ready!" -ForegroundColor Green
    }
} else {
    Write-Host "`n[1/4] Skipping Docker (--SkipDocker flag)" -ForegroundColor Gray
}

# Step 2: Check Python environment
Write-Host "`n[2/4] Checking Python environment..." -ForegroundColor Yellow
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python not found in PATH" -ForegroundColor Red
    exit 1
}

# Check if venv exists
if (Test-Path "venv\Scripts\activate.ps1") {
    Write-Host "Activating virtual environment..." -ForegroundColor Gray
    . .\venv\Scripts\activate.ps1
} elseif (Test-Path ".venv\Scripts\activate.ps1") {
    Write-Host "Activating virtual environment..." -ForegroundColor Gray
    . .\.venv\Scripts\activate.ps1
} else {
    Write-Host "No virtual environment found, using system Python" -ForegroundColor Yellow
}

# Step 3: Check dependencies
Write-Host "`n[3/4] Checking dependencies..." -ForegroundColor Yellow
python -c "import fastapi; import sqlalchemy; import redis" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing dependencies..." -ForegroundColor Gray
    pip install -r requirements.txt
}
Write-Host "Dependencies OK!" -ForegroundColor Green

# Step 4: Start services
Write-Host "`n[4/4] Starting services..." -ForegroundColor Yellow

if ($WsOnly) {
    Write-Host "Starting WebSocket Gateway only (port 8001)..." -ForegroundColor Cyan
    Set-Location ..
    $env:PYTHONPATH = "$PWD\backend;$env:PYTHONPATH"
    python -m uvicorn ws_gateway.main:app --reload --reload-include "*.py" --port 8001
    Set-Location backend
} elseif ($ApiOnly) {
    Write-Host "Starting REST API only (port 8000)..." -ForegroundColor Cyan
    uvicorn rest_api.main:app --reload --reload-include "*.py" --port 8000
} else {
    # Start both services
    Write-Host "Starting REST API (port 8000) and WebSocket Gateway (port 8001)..." -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Gray
    Write-Host ""

    # Start REST API in background job
    $apiJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        if (Test-Path "venv\Scripts\activate.ps1") { . .\venv\Scripts\activate.ps1 }
        elseif (Test-Path ".venv\Scripts\activate.ps1") { . .\.venv\Scripts\activate.ps1 }
        uvicorn rest_api.main:app --reload --reload-include "*.py" --port 8000 2>&1
    }

    # Start WebSocket Gateway in foreground
    Start-Sleep -Seconds 2
    Write-Host "[REST API] Started in background (Job ID: $($apiJob.Id))" -ForegroundColor Green
    Write-Host "[WS Gateway] Starting in foreground..." -ForegroundColor Green
    Write-Host ""

    try {
        Set-Location ..
        $env:PYTHONPATH = "$PWD\backend;$env:PYTHONPATH"
        python -m uvicorn ws_gateway.main:app --reload --reload-include "*.py" --port 8001
    } finally {
        Set-Location backend
        Write-Host "`nStopping background jobs..." -ForegroundColor Yellow
        Stop-Job -Job $apiJob -ErrorAction SilentlyContinue
        Remove-Job -Job $apiJob -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`nBackend stopped." -ForegroundColor Cyan
