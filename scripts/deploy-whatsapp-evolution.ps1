# Publica o suporte a Evolution API (WhatsApp por loja: Z-API ou Evolution)
# Uso: .\scripts\deploy-whatsapp-evolution.ps1
# Sem SUPABASE_ACCESS_TOKEN, abre o login do Supabase no navegador (só autorizar).
# Ordem importa: a migration precisa existir antes das functions novas.

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$EvolutionUrl = "https://whatsapp-evolution-api.6enkqw.easypanel.host"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Set-Location $Root

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Abrindo login do Supabase no navegador (clique em autorizar)..." -ForegroundColor Cyan
  npx supabase login
}

Write-Host "Linkando projeto $ProjectRef..." -ForegroundColor Cyan
npx supabase link --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) {
  Write-Host "Esta conta do Supabase nao tem acesso ao projeto $ProjectRef. Rode 'npx supabase logout' e entre com a conta dona do projeto." -ForegroundColor Red
  exit 1
}

Write-Host "Aplicando migration (whatsapp_provider / evolution_instance)..." -ForegroundColor Cyan
# Remove comentarios (--) para o CLI nao interpretar o SQL como flag.
$sql = (Get-Content -Encoding UTF8 "supabase\migrations\20261003120000_whatsapp_evolution.sql" |
  Where-Object { $_ -notmatch '^\s*--' }) -join " "
npx supabase db query $sql --linked
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao aplicar a migration. Nada foi publicado." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Cole a AUTHENTICATION_API_KEY da Evolution (Easypanel > evolution-api > Ambiente)." -ForegroundColor Yellow
$secure = Read-Host "API Key" -AsSecureString
$apiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $apiKey) {
  Write-Host "API Key vazia, abortando." -ForegroundColor Red
  exit 1
}
$webhookSecret = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))

Write-Host "Salvando secrets das Edge Functions..." -ForegroundColor Cyan
npx supabase secrets set --project-ref $ProjectRef `
  "EVOLUTION_API_URL=$EvolutionUrl" `
  "EVOLUTION_API_KEY=$apiKey" `
  "EVOLUTION_WEBHOOK_SECRET=$webhookSecret"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao salvar os secrets. As functions nao foram publicadas." -ForegroundColor Red
  exit 1
}

Write-Host "Deploy zapi-webhook..." -ForegroundColor Cyan
npx supabase functions deploy zapi-webhook --project-ref $ProjectRef --no-verify-jwt

Write-Host "Deploy send-whatsapp..." -ForegroundColor Cyan
npx supabase functions deploy send-whatsapp --project-ref $ProjectRef

Write-Host ""
Write-Host "Concluido." -ForegroundColor Green
Write-Host "  Lojas atuais continuam na Z-API sem mudanca."
Write-Host "  Para usar Evolution: Configuracoes > WhatsApp > Provedor 'Evolution API' > Conectar WhatsApp."
Write-Host "  Se rodar este script de novo, as lojas Evolution ja conectadas precisam clicar em Conectar"
Write-Host "  uma vez (o segredo do webhook muda)."
