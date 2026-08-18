# Deploy zapi-webhook + limpeza de sessoes WhatsApp (Easy Food Hub)
# Uso: $env:SUPABASE_ACCESS_TOKEN = "seu-token"; .\scripts\deploy-zapi-webhook.ps1

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Defina SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)" -ForegroundColor Red
  exit 1
}

Set-Location $Root

Write-Host "Linkando projeto $ProjectRef..." -ForegroundColor Cyan
npx supabase link --project-ref $ProjectRef

Write-Host "Deploy zapi-webhook..." -ForegroundColor Cyan
npx supabase functions deploy zapi-webhook --project-ref $ProjectRef --no-verify-jwt

Write-Host "Limpando sessoes do chatbot..." -ForegroundColor Cyan
$sql = "DELETE FROM public.whatsapp_pedido_sessions; UPDATE public.configuracoes SET whatsapp_pedido_ativo = true, zapi_ativo = true WHERE zapi_instance_id IS NOT NULL AND zapi_token IS NOT NULL AND zapi_client_token IS NOT NULL;"
npx supabase db query $sql --linked

Write-Host "Verificando endpoint..." -ForegroundColor Cyan
curl.exe -s "https://$ProjectRef.supabase.co/functions/v1/zapi-webhook"

Write-Host ""
Write-Host "Concluido. Confira no Dashboard:" -ForegroundColor Green
Write-Host "  Edge Functions > zapi-webhook > JWT Verification = OFF"
Write-Host "  Configuracoes do app > Configurar webhook na Z-API"
