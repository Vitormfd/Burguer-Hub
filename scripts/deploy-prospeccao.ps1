# Publica o agente de prospeccao do Easy Food Hub.
# Uso: .\scripts\deploy-prospeccao.ps1
#
# O que faz (nessa ordem):
#   1. Login/link no projeto Supabase (abre o navegador se precisar - so autorizar)
#   2. Aplica a migration da prospeccao (pode rodar de novo sem estragar nada)
#   3. Cadastra o seu e-mail como administrador da prospeccao
#   4. Gera o segredo do cron (a cada 5 min) e salva nas Edge Functions e no Vault
#   5. Chaves opcionais: Anthropic (se ainda nao estiver salva) e Google Places
#   6. Publica as Edge Functions prospeccao-agente e prospeccao-whatsapp
# O agente nasce PAUSADO. Chaves nunca aparecem na tela nem ficam salvas em arquivo.

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# Roda um SQL via arquivo temporario (UTF-8 sem BOM: o BOM do PowerShell 5 quebra o SQL).
function Run-Sql($sql) {
  $tmp = Join-Path $env:TEMP ("efh-prosp-" + [guid]::NewGuid().ToString("N") + ".sql")
  try {
    [IO.File]::WriteAllText($tmp, $sql)
    npx supabase db query --linked --file $tmp
    return ($LASTEXITCODE -eq 0)
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

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
  # O login pelo navegador as vezes falha no Supabase ("Could not create CLI login session").
  # O Access Token da conta dona funciona sempre e vale so para este processo.
  Write-Host "A conta logada no Supabase CLI nao tem acesso a este projeto." -ForegroundColor Yellow
  Write-Host "Entre no Supabase com a conta DONA do Burguer Hub e gere um token em:" -ForegroundColor Yellow
  Write-Host "  https://supabase.com/dashboard/account/tokens  (Generate new token)" -ForegroundColor Yellow
  Write-Host "Cole o token aqui (comeca com sbp_). Enter vazio = tentar o login pelo navegador." -ForegroundColor Yellow
  $token = Read-Secret "SUPABASE_ACCESS_TOKEN"
  if ($token) {
    $env:SUPABASE_ACCESS_TOKEN = $token.Trim()
  } else {
    npx supabase logout --yes
    npx supabase login
  }
  $token = $null
  npx supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Fail "Ainda sem acesso ao projeto $ProjectRef. Nada foi alterado." }
}

# 2) Migration ----------------------------------------------------------------------
Step "Aplicando migration 20261026120000_prospeccao_agente.sql"
npx supabase db query --linked --file "supabase\migrations\20261026120000_prospeccao_agente.sql"
if ($LASTEXITCODE -ne 0) { Fail "Falha na migration. Nada foi publicado (o app segue como estava)." }

# 3) Administrador ------------------------------------------------------------------
Step "Administrador da prospeccao"
Write-Host "E-mail da SUA conta no Easy Food Hub (so ela vai ver o menu Prospeccao)." -ForegroundColor Yellow
$email = (Read-Host "E-mail").Trim().ToLower()
if ($email -notmatch '^[^@\s'']+@[^@\s'']+\.[^@\s'']+$') { Fail "E-mail invalido." }
$adminSql = @"
INSERT INTO public.prospeccao_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = '$email'
ON CONFLICT (user_id) DO NOTHING;
SELECT count(*) AS admins_com_este_email FROM public.prospeccao_admins a JOIN auth.users u ON u.id = a.user_id WHERE lower(u.email) = '$email';
"@
if (-not (Run-Sql $adminSql)) { Fail "Nao consegui cadastrar o administrador." }
Write-Host "Se 'admins_com_este_email' saiu 0, o e-mail nao tem conta: cadastre-se no app e rode o script de novo." -ForegroundColor Yellow

# 4) Segredo do cron ------------------------------------------------------------------
Step "Configurando o cron do agente (a cada 5 minutos, respeitando a agenda do painel)"
$cronSecret = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$projectUrl = "https://$ProjectRef.supabase.co"
$vaultSql = @"
DO `$v`$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'project_url';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$projectUrl', 'project_url');
  ELSE PERFORM vault.update_secret(v_id, '$projectUrl'); END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'prospeccao_cron_secret';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$cronSecret', 'prospeccao_cron_secret');
  ELSE PERFORM vault.update_secret(v_id, '$cronSecret'); END IF;
END
`$v`$;
"@
$vaultOk = Run-Sql $vaultSql
if (-not $vaultOk) {
  Write-Host "Nao consegui gravar no Vault. A agenda automatica fica parada, mas 'Executar agora' funciona." -ForegroundColor Yellow
}

# 5) Chaves ------------------------------------------------------------------------------
Step "Conferindo as chaves ja salvas nas Edge Functions"
$lista = (npx supabase secrets list --project-ref $ProjectRef 2>&1 | Out-String)
$temAnthropic = $lista -match "ANTHROPIC_API_KEY"
$temEvolution = ($lista -match "EVOLUTION_API_URL") -and ($lista -match "EVOLUTION_API_KEY") -and ($lista -match "EVOLUTION_WEBHOOK_SECRET")

$secretArgs = @("PROSPECCAO_CRON_SECRET=$cronSecret")

Write-Host ""
if ($temAnthropic) {
  Write-Host "ANTHROPIC_API_KEY ja esta salva (a mesma da IA do WhatsApp). Enter para manter, ou cole uma nova." -ForegroundColor Yellow
} else {
  Write-Host "ANTHROPIC_API_KEY nao encontrada. Sem ela o agente NAO pesquisa (console.anthropic.com > API Keys)." -ForegroundColor Yellow
}
$anthropicKey = Read-Secret "ANTHROPIC_API_KEY"
if ($anthropicKey) { $secretArgs += "ANTHROPIC_API_KEY=$anthropicKey" }
$anthropicKey = $null

Write-Host ""
Write-Host "GOOGLE_PLACES_API_KEY (opcional): traz telefone e dados oficiais do Google Maps." -ForegroundColor Yellow
Write-Host "Sem ela o agente usa so a busca na web. Enter para pular." -ForegroundColor Yellow
$placesKey = Read-Secret "GOOGLE_PLACES_API_KEY"
if ($placesKey) { $secretArgs += "GOOGLE_PLACES_API_KEY=$placesKey" }
$placesKey = $null

Step "Salvando secrets das Edge Functions"
npx supabase secrets set --project-ref $ProjectRef @secretArgs
if ($LASTEXITCODE -ne 0) { Fail "Falha ao salvar os secrets. As functions nao foram publicadas." }
$secretArgs = $null

if (-not $temEvolution) {
  Write-Host "Aviso: secrets da Evolution (EVOLUTION_API_URL/KEY/WEBHOOK_SECRET) nao encontrados." -ForegroundColor Yellow
  Write-Host "O WhatsApp comercial so funciona depois de rodar .\scripts\deploy-whatsapp-evolution.ps1" -ForegroundColor Yellow
}

# 6) Edge Functions ------------------------------------------------------------------------
Step "Publicando prospeccao-agente"
npx supabase functions deploy prospeccao-agente --project-ref $ProjectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar prospeccao-agente." }

Step "Publicando prospeccao-whatsapp"
npx supabase functions deploy prospeccao-whatsapp --project-ref $ProjectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar prospeccao-whatsapp (o agente ja esta no ar)." }

# Conferencia ------------------------------------------------------------------------------
Step "Conferindo"
npx supabase db query --linked "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('prospects','prospect_identificadores','prospect_mensagens','prospeccao_buscas','prospeccao_execucoes','prospeccao_config')) as tabelas, (select count(*) from public.prospeccao_admins) as admins, (select count(*) from cron.job where jobname='prospeccao_agente_tick') as cron, (select ativo from public.prospeccao_config where id=1) as agente_ligado"

Write-Host ""
Write-Host "Concluido! (esperado: tabelas=6, admins>=1, cron=1, agente_ligado=false)" -ForegroundColor Green
Write-Host "  - Publique o front (push na main -> Vercel) para o menu 'Prospeccao' aparecer."
Write-Host "  - O agente comeca PAUSADO. No painel: Configuracao > conectar WhatsApp comercial,"
Write-Host "    depois Painel > 'Executar agora' para o piloto."
