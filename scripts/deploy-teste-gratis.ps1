# Publica o teste grátis de 7 dias e as travas do WhatsApp.
# Uso: .\scripts\deploy-teste-gratis.ps1
#
# O que faz (nessa ordem, porque as functions dependem das funções novas do banco):
#   1. Login/link no projeto Supabase
#   2. Confere se a migration de assinaturas já foi aplicada
#   3. Aplica 20261105120000_teste_gratis.sql. Contas existentes não mudam
#   4. Publica send-whatsapp, zapi-webhook e marketing-automacoes
#
# O front e as páginas de venda saem com o push na main. Antes do push:
#   - o pixel já está no código (src/lib/metaPixel.ts e LP/EasyFoodHubLp/seo/paginas.js);
#   - depois de mudar a landing, rode npm run build:seo em LP/EasyFoodHubLp.

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

# O CLI pode estar logado em outra conta da Supabase: sem acesso, pede o token da conta dona.
Step "Conectando ao projeto Supabase $ProjectRef"
$ErrorActionPreference = "Continue"
npx supabase link --project-ref $ProjectRef 2>&1 | Out-Host
$linked = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"
if (-not $linked) {
  Write-Host "Cole um Access Token da conta DONA do projeto (https://supabase.com/dashboard/account/tokens). Ele nao aparece na tela." -ForegroundColor Yellow
  $env:SUPABASE_ACCESS_TOKEN = (Read-Secret "SUPABASE_ACCESS_TOKEN").Trim()
  npx supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Fail "Sem acesso ao projeto $ProjectRef. Nada foi alterado." }
}

Step "Conferindo a migration de assinaturas"
npx supabase db query --linked "select 1 from public.assinaturas limit 0" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "A tabela assinaturas não existe. Rode antes .\scripts\deploy-assinaturas.ps1. Nada foi alterado." }

Step "Aplicando migration 20261105120000_teste_gratis.sql"
npx supabase db query --linked --file "supabase\migrations\20261105120000_teste_gratis.sql"
if ($LASTEXITCODE -ne 0) { Fail "Falha na migration. As functions NAO foram publicadas." }

$funcoes = @(
  @{ nome = "send-whatsapp"; semJwt = $false },
  @{ nome = "zapi-webhook"; semJwt = $true },
  @{ nome = "marketing-automacoes"; semJwt = $true }
)
foreach ($f in $funcoes) {
  Step "Publicando $($f.nome)"
  if ($f.semJwt) { npx supabase functions deploy $f.nome --project-ref $ProjectRef --no-verify-jwt }
  else { npx supabase functions deploy $f.nome --project-ref $ProjectRef }
  if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar $($f.nome)." }
}

Step "Conferindo (só totais, sem dados pessoais)"
npx supabase db query --linked "select count(*) filter (where public.conta_liberada(p.id)) as liberadas, count(*) filter (where a.teste_ate > now()) as em_teste, count(*) as contas, (select count(*) from pg_proc where proname = 'conta_whatsapp_liberada') as funcao_whatsapp from public.profiles p left join public.assinaturas a on a.owner_id = p.id"

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Green
Write-Host "  - Contas novas passam a ter 7 dias de teste. As existentes nao mudaram."
Write-Host "  - Falta o push na main (Burguer Hub) e no repositorio da landing."
