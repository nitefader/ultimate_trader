# start_backend.ps1 — Kill any stale process on port 8000, then launch the backend.
# Usage: .\scripts\start_backend.ps1

$PORT = 8000
$PID_FILE = "$PSScriptRoot\..\backend\.uvicorn.pid"

# Kill any process currently holding port 8000
$connections = netstat -ano | Select-String ":$PORT\s"
$pids = $connections | ForEach-Object {
    ($_ -split '\s+')[-1]
} | Sort-Object -Unique

foreach ($p in $pids) {
    if ($p -match '^\d+$' -and $p -ne '0') {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Killing stale process on port ${PORT}: PID $p ($($proc.Name))"
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
    }
}

# If a PID file exists from a previous run, clean it up
if (Test-Path $PID_FILE) {
    $oldPid = Get-Content $PID_FILE -ErrorAction SilentlyContinue
    if ($oldPid -match '^\d+$') {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $PID_FILE -Force
}

# Launch uvicorn from backend directory
$backendDir = Resolve-Path "$PSScriptRoot\..\backend"
Set-Location $backendDir

Write-Host "Starting UltraTrader backend on port $PORT..."
$proc = Start-Process -FilePath "uvicorn" `
    -ArgumentList "app.main:app", "--host", "0.0.0.0", "--port", "$PORT", "--reload" `
    -PassThru -NoNewWindow

$proc.Id | Out-File $PID_FILE -Encoding ascii
Write-Host "Backend started (PID $($proc.Id)). PID saved to $PID_FILE"
