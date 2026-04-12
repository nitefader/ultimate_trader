$ErrorActionPreference = "Stop"

Write-Host "== Backend: pytest ==" -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "..\\backend")
try {
  # Prefer module invocation so it works as long as the intended Python env is active.
  python -m pytest -q

  Write-Host "== Backend: critical path suite ==" -ForegroundColor Cyan
  python -m pytest -q tests/test_critical_path_workflow_api.py tests/test_backtests_compare_api.py tests/test_control_strategy_scope_api.py
} finally {
  Pop-Location
}

Write-Host "== Frontend: build ==" -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "..\\frontend")
try {
  if (Test-Path package-lock.json) {
    npm ci
  } else {
    npm install
  }
  npm run build

  if (Get-Command npm -ErrorAction SilentlyContinue) {
    try {
      npm run storybook:build
    } catch {
      Write-Warning "storybook:build failed or Storybook deps not installed yet"
    }
  }
} finally {
  Pop-Location
}

Write-Host "QA OK" -ForegroundColor Green
