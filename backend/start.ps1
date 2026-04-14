# Start the backend using the project venv exclusively.
# Prepends venv Scripts to PATH so uvicorn's child worker also uses venv Python.
$root = $PSScriptRoot
$venvScripts = Join-Path $root ".venv\Scripts"
$venvPython  = Join-Path $venvScripts "python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Error "Venv not found at $venvPython — run: python -m venv .venv && pip install -r requirements.txt"
    exit 1
}

# Put venv Scripts FIRST so uvicorn subprocess finds the right python
$env:PATH = "$venvScripts;$env:PATH"
$env:PYTHONPATH = $root

Set-Location $root
Write-Host "Starting backend with $venvPython"
& $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000
