$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backendDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "backend"))
$javaDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "java-socket-server"))
$pythonExecutable = Join-Path $backendDirectory ".venv\Scripts\python.exe"
$dataDirectory = [System.IO.Path]::GetFullPath((Join-Path $backendDirectory "data"))

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw "Backend virtual environment not found: $pythonExecutable"
}
if (-not (Test-Path -LiteralPath $dataDirectory)) {
    New-Item -ItemType Directory -Path $dataDirectory | Out-Null
}

$databaseName = "realtime-suite-$([guid]::NewGuid().ToString('N')).db"
$temporaryDatabase = [System.IO.Path]::GetFullPath((Join-Path $dataDirectory $databaseName))
$dataPrefix = $dataDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $temporaryDatabase.StartsWith($dataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary database path escaped backend/data: $temporaryDatabase"
}
if (Test-Path -LiteralPath $temporaryDatabase) {
    throw "Temporary database already exists: $temporaryDatabase"
}

$hadDatabaseUrl = Test-Path Env:DATABASE_URL
$previousDatabaseUrl = $env:DATABASE_URL
$hadDatabasePath = Test-Path Env:DATABASE_PATH
$previousDatabasePath = $env:DATABASE_PATH
$backendExitCode = 1
$javaExitCode = 1

try {
    $env:DATABASE_URL = "sqlite:///./data/$databaseName"

    Write-Host "Running FastAPI tests, including live Browser-to-Java TCP realtime acceptance..."
    Push-Location $backendDirectory
    try {
        & $pythonExecutable -m pytest -q tests -p no:cacheprovider
        $backendExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    Write-Host "Running Java TCP server tests..."
    Push-Location $javaDirectory
    try {
        $env:DATABASE_PATH = $temporaryDatabase.Replace([char]92, [char]47)
        & mvn test
        $javaExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($hadDatabaseUrl) {
        $env:DATABASE_URL = $previousDatabaseUrl
    }
    else {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
    if ($hadDatabasePath) {
        $env:DATABASE_PATH = $previousDatabasePath
    }
    else {
        Remove-Item Env:DATABASE_PATH -ErrorAction SilentlyContinue
    }

    Remove-Item -LiteralPath $temporaryDatabase -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($temporaryDatabase + "-wal") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($temporaryDatabase + "-shm") -Force -ErrorAction SilentlyContinue
}

Write-Host "FastAPI test exit code: $backendExitCode"
Write-Host "Java test exit code: $javaExitCode"
if ($backendExitCode -ne 0 -or $javaExitCode -ne 0) {
    exit 1
}

Write-Host "All FastAPI tests, live realtime E2E acceptance, and Java TCP tests passed."
