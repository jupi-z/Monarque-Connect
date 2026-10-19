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
$databaseName = "monarque_ci_$PID"
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/$databaseName"
$env:MESSAGING_ABUSE_HMAC_KEY = 'local-ci-messaging-abuse-key'

$compose = Join-Path (Get-Location) 'docker-compose.dev.yml'
Invoke-Step 'Start PostgreSQL service' { docker compose -f $compose up -d postgres }
try {
  for ($i = 0; $i -lt 30; $i++) {
    docker compose -f $compose exec -T postgres pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  docker compose -f $compose exec -T postgres pg_isready -U postgres *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready within 30 seconds.' }

  Invoke-Step 'Create disposable CI database' {
    docker compose -f $compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "CREATE DATABASE $databaseName"
  }

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
  Invoke-Step 'Apply current migrations' { npm run prisma:deploy }
  Invoke-Step 'OpenAPI validation' { npm run openapi:validate }
  Invoke-Step 'Contract validation' { npm run contracts:validate }
  Invoke-Step 'Unit and integration test suite' { npm test }
  Invoke-Step 'HTTP E2E suite' { npm run test:e2e }
  Invoke-Step 'Production build' { npm run build }
  Write-Host "`nLocal CI mirror passed all available checks." -ForegroundColor Green
} finally {
  try { docker compose -f $compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS $databaseName WITH (FORCE)" 1> $null 2> $null } catch { }
  try { docker compose -f $compose down 1> $null 2> $null } catch { }
}
