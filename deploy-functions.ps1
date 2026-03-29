# Read SUPABASE_ACCESS_TOKEN from .env.local if set
$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^SUPABASE_ACCESS_TOKEN=(.+)$") {
      $env:SUPABASE_ACCESS_TOKEN = $matches[1]
    }
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  $env:SUPABASE_ACCESS_TOKEN = Read-Host "Paste your Supabase access token"
}

Write-Host "Deploying sync-profile..." -ForegroundColor Cyan
npx supabase@1.207.9 functions deploy sync-profile --project-ref otkxwlogknxhnwyzkfxq --no-verify-jwt

Write-Host "Deploying sync-poll..." -ForegroundColor Cyan
npx supabase@1.207.9 functions deploy sync-poll --project-ref otkxwlogknxhnwyzkfxq

Write-Host "Done." -ForegroundColor Green
