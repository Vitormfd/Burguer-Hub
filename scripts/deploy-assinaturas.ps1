# Publica a cobrança do Easy Food Hub (Stripe) e o modo demonstração.
# Uso: .\scripts\deploy-assinaturas.ps1
#
# O que faz (nessa ordem):
#   1. Login/link no projeto Supabase (pede um Access Token se precisar)
#   2. Aplica a migration de assinaturas. Contas que já existem ficam LIBERADAS;
#      as novas entram em modo demonstração (montam a loja, mas não operam)
#   3. Mostra as contas existentes, para você revisar na tela Assinaturas quem não é cliente
#   4. Salva o STRIPE_WEBHOOK_SECRET (opcional agora; Enter pula)
#   5. Publica stripe-webhook e as funções que passaram a respeitar a assinatura
# Chaves nunca aparecem na tela nem ficam salvas em arquivo.

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

function Read-Secret($nome) {
  $secure = Read-Host $nome -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# 1) Login + link -----------------------------------------------------------------
Step "Conectando ao projeto Supabase $ProjectRef"
$ErrorActionPreference = "Continue"
npx supabase link --project-ref $ProjectRef 2>&1 | Out-Host
$linked = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"
if (-not $linked) {
  Write-Host "Cole um Access Token da conta DONA do projeto (https://supabase.com/dashboard/account/tokens)." -ForegroundColor Yellow
  $env:SUPABASE_ACCESS_TOKEN = (Read-Secret "SUPABASE_ACCESS_TOKEN").Trim()
  npx supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Fail "Sem acesso ao projeto $ProjectRef. Nada foi alterado." }
}

# 2) Migration -----------------------------------------------------------------------
Step "Aplicando migration 20261027120000_assinaturas.sql"
npx supabase db query --linked --file "supabase\migrations\20261027120000_assinaturas.sql"
if ($LASTEXITCODE -ne 0) { Fail "Falha na migration. As functions NAO foram publicadas." }

# 3) Contas existentes ------------------------------------------------------------------
Step "Contas existentes (todas ficaram liberadas; bloqueie quem nao e cliente na tela Assinaturas)"
npx supabase db query --linked "select u.email, to_char(p.created_at, 'DD/MM/YYYY') as criada, (select count(*) from public.pedidos pe where pe.owner_id = p.id and pe.criado_em > now() - interval '30 days') as pedidos_30d from public.profiles p join auth.users u on u.id = p.id order by p.created_at"

# 4) Segredo do webhook --------------------------------------------------------------------
Step "STRIPE_WEBHOOK_SECRET"
Write-Host "Na Stripe: Developers > Webhooks > Adicionar endpoint" -ForegroundColor Yellow
Write-Host "  URL: https://$ProjectRef.supabase.co/functions/v1/stripe-webhook" -ForegroundColor Yellow
Write-Host "  Eventos: checkout.session.completed, customer.subscription.created," -ForegroundColor Yellow
Write-Host "           customer.subscription.updated, customer.subscription.deleted" -ForegroundColor Yellow
Write-Host "Depois de criar, copie o 'Signing secret' (comeca com whsec_) e cole aqui. Enter = pular por agora." -ForegroundColor Yellow
$whsec = (Read-Secret "STRIPE_WEBHOOK_SECRET").Trim()
if ($whsec) {
  if ($whsec -notmatch '^whsec_') {
    Write-Host "Isso nao parece um signing secret (whsec_...). Nao foi salvo." -ForegroundColor Red
  } else {
    npx supabase secrets set --project-ref $ProjectRef "STRIPE_WEBHOOK_SECRET=$whsec"
    if ($LASTEXITCODE -ne 0) { Fail "Falha ao salvar o STRIPE_WEBHOOK_SECRET." }
    Write-Host "Salvo." -ForegroundColor Green
  }
}
$whsec = $null

# 5) Edge Functions ---------------------------------------------------------------------------
$funcoes = @(
  @{ nome = "stripe-webhook"; semJwt = $true },
  @{ nome = "zapi-webhook"; semJwt = $true },
  @{ nome = "marketing-automacoes"; semJwt = $true },
  @{ nome = "send-whatsapp"; semJwt = $false },
  @{ nome = "mp-pix-criar"; semJwt = $false }
)
foreach ($f in $funcoes) {
  Step "Publicando $($f.nome)"
  if ($f.semJwt) { npx supabase functions deploy $f.nome --project-ref $ProjectRef --no-verify-jwt }
  else { npx supabase functions deploy $f.nome --project-ref $ProjectRef }
  if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar $($f.nome)." }
}

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Green
Write-Host "  - Publique o front (push na main) para o aviso de modo demonstracao e a tela Assinaturas."
Write-Host "  - Se pulou o STRIPE_WEBHOOK_SECRET, rode este script de novo depois de criar o webhook."
