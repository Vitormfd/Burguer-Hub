# Pedido do site pago com Pix online passa a sair como PAGO na notinha.
# Uso: .\scripts\deploy-pix-pago.ps1
#
# O que faz:
#   1. Login/link no projeto Supabase (abre o navegador se precisar - so autorizar)
#   2. Aplica a migration que marca a entrega como paga quando o Pix e aprovado
#      (e corrige os pedidos Pix que ja entraram como "A pagar"). Pode rodar de novo.
#   3. Publica a mp-pix-webhook atual

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

Step "Conectando ao projeto Supabase $ProjectRef"
$ErrorActionPreference = "Continue"
npx supabase link --project-ref $ProjectRef 2>&1 | Out-Host
$linked = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"
if (-not $linked) {
  Write-Host "A conta logada no Supabase CLI nao tem acesso a este projeto." -ForegroundColor Yellow
  Write-Host "Vou sair dela e abrir o login: entre com a conta DONA do Burguer Hub." -ForegroundColor Yellow
  npx supabase logout --yes
  npx supabase login
  npx supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Fail "Ainda sem acesso ao projeto $ProjectRef. Nada foi alterado." }
}

$migration = "20261021120000_pix_online_marca_entrega_paga.sql"
Step "Aplicando migration $migration"
npx supabase db query --linked --file "supabase\migrations\$migration"
if ($LASTEXITCODE -ne 0) { Fail "Falha na migration $migration. Nada foi publicado." }

Step "Publicando mp-pix-webhook"
npx supabase functions deploy mp-pix-webhook --project-ref $ProjectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar mp-pix-webhook (a migration ja esta no ar e resolve sozinha)." }

Step "Conferindo"
npx supabase db query --linked "select count(*) as pix_aprovados_ainda_a_pagar from public.entregas e join public.pagamentos_pix pp on pp.pedido_id = e.pedido_id where pp.status = 'approved' and e.pago = false"

Write-Host ""
Write-Host "Concluido! Pedidos com Pix online agora saem como PAGO na notinha." -ForegroundColor Green
