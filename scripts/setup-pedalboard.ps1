[CmdletBinding()]
param(
  [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentDirectory = Join-Path $projectRoot ".venv-pedalboard"
$environmentPython = Join-Path $environmentDirectory "Scripts\python.exe"
$requirementsFile = Join-Path $projectRoot "requirements-pedalboard.txt"

if (-not (Test-Path -LiteralPath $requirementsFile -PathType Leaf)) {
  throw "Pedalboard requirements were not found at $requirementsFile"
}

if (-not (Test-Path -LiteralPath $environmentPython -PathType Leaf)) {
  Write-Output "Creating the Pedalboard Python environment..."
  & $PythonExecutable -m venv $environmentDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "Python could not create the Pedalboard environment."
  }
}

Write-Output "Installing the pinned Pedalboard dependencies..."
& $environmentPython -m pip install --requirement $requirementsFile
if ($LASTEXITCODE -ne 0) {
  throw "Pedalboard dependency installation failed."
}

& $environmentPython -m pip check
if ($LASTEXITCODE -ne 0) {
  throw "The Pedalboard environment contains incompatible dependencies."
}

$probe = "import importlib.metadata, numpy, pedalboard; print('Pedalboard environment ready: numpy {}, pedalboard {}'.format(numpy.__version__, importlib.metadata.version('pedalboard')))"
& $environmentPython -c $probe
if ($LASTEXITCODE -ne 0) {
  throw "The Pedalboard modules could not be imported."
}
