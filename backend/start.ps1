# Start the backend using the project venv exclusively.
# Always runs from $PSScriptRoot (the backend/ directory) regardless of where
# this script is invoked from — prevents the wrong ultratrader.db from loading.
$root = $PSScriptRoot
$venvScripts = Join-Path $root "..\venv\Scripts"
# Support venv at project root (.venv) or backend-local (venv)
$venvAtRoot  = Join-Path $root "..\.venv\Scripts\python.exe"
$venvLocal   = Join-Path $root "venv\Scripts\python.exe"
if (Test-Path $venvAtRoot)       { $venvPython = $venvAtRoot }
elseif (Test-Path $venvLocal)    { $venvPython = $venvLocal }
else {
    Write-Error "Venv not found — run: python -m venv .venv && pip install -r requirements.txt"
    exit 1
}

# Free port 8000 if something is already holding it
$occupants = (netstat -ano | Select-String ":8000\s.*LISTENING") -replace '.*LISTENING\s+', '' | ForEach-Object { $_.Trim() } | Sort-Object -Unique
foreach ($p in $occupants) {
    if ($p -match '^\d+$') {
        Write-Host "Releasing port 8000 (PID $p)..."
        taskkill /PID $p /F /T 2>&1 | Out-Null
    }
}
if ($occupants) { Start-Sleep -Seconds 1 }

# Always cd to backend/ so relative paths (logs, data, configs) resolve correctly
Set-Location $root
$env:PATH = "$(Split-Path $venvPython);$env:PATH"

Write-Host "Starting backend from $root"
Write-Host "Python: $venvPython"
& $venvPython -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
