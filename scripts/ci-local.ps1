$ErrorActionPreference = 'Stop'

function Invoke-Step([string] $Name, [scriptblock] $Action) {
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

if ((git status --porcelain)) { throw 'Checkout must be clean before running the local CI mirror.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is unavailable. Start Docker Desktop, then rerun npm run ci:local.' }

$env:NODE_ENV = 'test'
$env:PORT = '3000'
$databaseName = 'monarque_connect_test'
$containerName = "monarque-local-ci-postgres-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 10))"
$containerStarted = $false
$env:MESSAGING_ABUSE_HMAC_KEY = 'local-ci-messaging-abuse-key'

try {
Invoke-Step 'Start disposable PostgreSQL container' {
  docker run -d --name $containerName `
    -e POSTGRES_USER=postgres `
    -e POSTGRES_PASSWORD=postgres `
    -e "POSTGRES_DB=$databaseName" `
    -p 127.0.0.1::5432 `
    --health-cmd 'pg_isready -U postgres' `
    --health-interval 2s `
    --health-timeout 5s `
    --health-retries 30 `
    postgres:17
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the disposable PostgreSQL container.' }
  $containerStarted = $true
  $portMapping = docker port $containerName '5432/tcp'
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the disposable PostgreSQL port.' }
  $portMatch = [regex]::Match(($portMapping | Select-Object -First 1), ':(\d+)$')
  if (-not $portMatch.Success) { throw 'Could not determine the disposable PostgreSQL host port.' }
  $databasePort = $portMatch.Groups[1].Value
  $env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$databasePort/$databaseName"
  $env:TEST_DATABASE_URL = $env:DATABASE_URL
}
  for ($i = 0; $i -lt 30; $i++) {
    $health = docker inspect --format '{{.State.Health.Status}}' $containerName 2>$null
    if ($LASTEXITCODE -eq 0 -and $health -eq 'healthy') { break }
    Start-Sleep -Seconds 1
  }
  if ($health -ne 'healthy') { docker logs $containerName; throw 'Disposable PostgreSQL did not become ready within 30 seconds.' }

  Invoke-Step 'Install locked dependencies' { npm ci }
  Invoke-Step 'Generate Prisma client' { npm run prisma:generate }

  $auditFile = Join-Path $env:TEMP "monarque-npm-audit-$PID.json"
  try {
    Write-Host "`n=== Audit runtime dependency graph ===" -ForegroundColor Cyan
    $auditOutput = npm.cmd audit --json 2> $null
    $auditExit = $LASTEXITCODE
    [System.IO.File]::WriteAllText($auditFile, ($auditOutput -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    node scripts/check-runtime-audit.mjs $auditFile
    if ($LASTEXITCODE -ne 0) { throw "Runtime dependency audit failed (npm audit exit $auditExit)." }
  } finally { Remove-Item -LiteralPath $auditFile -Force -ErrorAction SilentlyContinue }

  Invoke-Step 'Lint' { npm run lint }
  Invoke-Step 'Typecheck' { npm run typecheck }
  Invoke-Step 'Prisma schema validation' { npm run prisma:validate }
  Invoke-Step 'Phase 2 migration proof' { npm run prisma:phase2:migration-proof }
  Invoke-Step 'Phase 3 migration proof' { npm run prisma:phase3:migration-proof }
  Invoke-Step 'Phase 5 migration proof' { npm run prisma:phase5:migration-proof }
  Invoke-Step 'Phase 6 migration proof' { npm run prisma:phase6:migration-proof }
  Invoke-Step 'Phase 7 migration proof' { npm run prisma:phase7:migration-proof }
  Invoke-Step 'Phase 8 migration proof' { npm run prisma:phase8:migration-proof }
  Invoke-Step 'Phase 9 and Phase 9.5 migration proofs' { npm run prisma:phase9:migration-proof }
  Invoke-Step 'Phase 9.6 migration proof' { npm run prisma:phase96:migration-proof }
  Invoke-Step 'Phase 10A migration proof' { npm run prisma:phase10a:migration-proof }
  Invoke-Step 'Apply current migrations' { npm run prisma:deploy }
  Invoke-Step 'OpenAPI validation' { npm run openapi:validate }
  Invoke-Step 'Contract validation' { npm run contracts:validate }
  Invoke-Step 'Billing operational preflight' { npm run billing:preflight }
  Invoke-Step 'Database-free unit tests' {
    npm run test:unit -- --pool=forks --maxWorkers=1 --no-file-parallelism --testTimeout=30000 --hookTimeout=60000
  }
  Invoke-Step 'PostgreSQL integration tests' {
    npm run test:integration -- --pool=forks --maxWorkers=1 --no-file-parallelism --testTimeout=30000 --hookTimeout=60000
  }
  Invoke-Step 'Prepare isolated HTTP E2E database' {
    docker exec $containerName createdb -U postgres monarque_connect_test_e2e
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated E2E database.' }
    $e2eDatabaseUrl = $env:DATABASE_URL -replace '/monarque_connect_test$', '/monarque_connect_test_e2e'
    $env:DATABASE_URL = $e2eDatabaseUrl
    $env:TEST_DATABASE_URL = $e2eDatabaseUrl
  }
  Invoke-Step 'Migrate isolated HTTP E2E database' { npm run prisma:deploy }
  Invoke-Step 'HTTP E2E suite' {
    npm run test:e2e -- --pool=forks --maxWorkers=1 --no-file-parallelism --testTimeout=30000
  }
  Invoke-Step 'Production build' { npm run build }
  Write-Host "`nLocal CI mirror passed all available checks." -ForegroundColor Green
} finally {
  if ($containerStarted) { try { docker rm -f $containerName 1> $null 2> $null } catch { } }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
