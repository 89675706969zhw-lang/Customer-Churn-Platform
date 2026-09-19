$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONUTF8 = '1'
python -c "import fastapi, uvicorn, lightgbm, duckdb, pandas, sklearn, httpx"
if ($LASTEXITCODE -ne 0) {
    python -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
}
Push-Location -LiteralPath (Join-Path $PSScriptRoot 'frontend')
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'Open http://127.0.0.1:8000 after application startup completes. Ctrl+C stops the server.'
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
