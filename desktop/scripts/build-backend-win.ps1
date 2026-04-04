$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendDir = Join-Path $RepoRoot "backend"
$BuildVenv = Join-Path $BackendDir ".venv-desktop"
$PyInstallerExe = Join-Path $BuildVenv "Scripts\pyinstaller.exe"
$PythonExe = Join-Path $BuildVenv "Scripts\python.exe"
$DistDir = Join-Path $RepoRoot "desktop\backend-dist"
$WorkDir = Join-Path $RepoRoot "build\surtaal-backend"
$SpecFile = Join-Path $RepoRoot "surtaal-backend.spec"
$VendorBinDir = Join-Path $RepoRoot "desktop\vendor\bin"

if (-not (Test-Path $PythonExe)) {
  py -3 -m venv $BuildVenv
}

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $BackendDir "requirements-desktop.txt")

if (Test-Path $DistDir) {
  Remove-Item $DistDir -Recurse -Force
}

if (Test-Path $WorkDir) {
  Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $SpecFile) {
  Remove-Item $SpecFile -Force -ErrorAction SilentlyContinue
}

& $PyInstallerExe `
  --noconfirm `
  --clean `
  --onedir `
  --name surtaal-backend `
  --paths $BackendDir `
  --collect-all numpy `
  --collect-all scipy `
  --collect-all numba `
  --collect-all llvmlite `
  --collect-all sklearn `
  --collect-all joblib `
  --collect-all audioread `
  --collect-all soxr `
  --collect-all librosa `
  --collect-all soundfile `
  --collect-all pydub `
  --collect-all demucs `
  --collect-all certifi `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.websockets.auto `
  --hidden-import uvicorn.lifespan.on `
  --distpath $DistDir `
  --workpath $WorkDir `
  (Join-Path $BackendDir "main.py")

if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller backend bundling failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path (Join-Path $DistDir "surtaal-backend\surtaal-backend.exe"))) {
  throw "PyInstaller finished without producing desktop\backend-dist\surtaal-backend\surtaal-backend.exe"
}

$RubberbandExe = Join-Path $VendorBinDir "rubberband.exe"
if (Test-Path $RubberbandExe) {
  $RubberbandDlls = Get-ChildItem -Path $VendorBinDir -Filter "*.dll" -ErrorAction SilentlyContinue
  if (-not $RubberbandDlls) {
    Write-Warning "rubberband.exe is present, but no DLLs were found in desktop\vendor\bin. If tempo/pitch fails on Windows, copy the full Rubber Band Windows package contents, not just rubberband.exe."
  }
}

Write-Host ""
Write-Host "Backend bundle created at:"
Write-Host "  $DistDir\surtaal-backend"
