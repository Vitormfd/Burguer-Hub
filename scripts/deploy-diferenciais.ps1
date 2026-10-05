# Publica os diferenciais: Estoque & Lucro, Marketing automatico, IA no WhatsApp,
# acompanhamento do pedido + avaliacao.
# Uso: .\scripts\deploy-diferenciais.ps1
#
# O que faz (nessa ordem):
#   1. Login/link no projeto Supabase (abre o navegador se precisar - so autorizar)
#   2. Aplica as migrations (Evolution + 4 novas). Todas podem rodar de novo sem estragar nada.
#   3. Gera o segredo do cron de marketing e salva nas Edge Functions e no Vault
#   4. Pede a chave da Anthropic (opcional; sem ela a IA do WhatsApp fica desligada)
#   5. Publica as Edge Functions
# Chaves nunca aparecem na tela nem ficam salvas em arquivo.

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# 1) Login + link -----------------------------------------------------------------
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

# 2) Migrations ----------------------------------------------------------------------
$migrations = @(
  "20261003120000_whatsapp_evolution.sql",
  "20261004120000_estoque_ficha_tecnica.sql",
  "20261004130000_acompanhamento_avaliacoes.sql",
  "20261004140000_marketing_automacoes.sql",
  "20261004150000_whatsapp_ia.sql"
)
foreach ($m in $migrations) {
  Step "Aplicando migration $m"
  npx supabase db query --linked --file "supabase\migrations\$m"
  if ($LASTEXITCODE -ne 0) { Fail "Falha na migration $m. As functions NAO foram publicadas (o app segue como estava)." }
}

# 3) Segredo do cron de marketing ------------------------------------------------------
Step "Configurando o envio automatico de marketing (cron de hora em hora)"
$cronSecret = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$projectUrl = "https://$ProjectRef.supabase.co"
$vaultSql = @"
DO `$v`$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'project_url';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$projectUrl', 'project_url');
  ELSE PERFORM vault.update_secret(v_id, '$projectUrl'); END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'marketing_cron_secret';
  IF v_id IS NULL THEN PERFORM vault.create_secret('$cronSecret', 'marketing_cron_secret');
  ELSE PERFORM vault.update_secret(v_id, '$cronSecret'); END IF;
END
`$v`$;
"@
$tmp = Join-Path $env:TEMP ("bh-vault-" + [guid]::NewGuid().ToString("N") + ".sql")
try {
  # UTF-8 sem BOM (o BOM do Set-Content no PowerShell 5 quebra o SQL)
  [IO.File]::WriteAllText($tmp, $vaultSql)
  npx supabase db query --linked --file $tmp
  $vaultOk = ($LASTEXITCODE -eq 0)
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
if (-not $vaultOk) {
  Write-Host "Nao consegui gravar no Vault. O envio automatico fica parado, mas o botao 'Executar agora' funciona." -ForegroundColor Yellow
}

# 4) Chave da Anthropic (IA do WhatsApp) -------------------------------------------------
Write-Host ""
Write-Host "Chave da API da Anthropic para a IA do WhatsApp (console.anthropic.com > API Keys)." -ForegroundColor Yellow
Write-Host "Cole e aperte Enter. Para pular (IA fica indisponivel), so aperte Enter." -ForegroundColor Yellow
$secure = Read-Host "ANTHROPIC_API_KEY" -AsSecureString
$anthropicKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Step "Salvando secrets das Edge Functions"
$secretArgs = @("MARKETING_CRON_SECRET=$cronSecret")
if ($anthropicKey) { $secretArgs += "ANTHROPIC_API_KEY=$anthropicKey" }
npx supabase secrets set --project-ref $ProjectRef @secretArgs
if ($LASTEXITCODE -ne 0) { Fail "Falha ao salvar os secrets. As functions nao foram publicadas." }
$anthropicKey = $null

# 5) Edge Functions ------------------------------------------------------------------------
Step "Publicando marketing-automacoes"
npx supabase functions deploy marketing-automacoes --project-ref $ProjectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar marketing-automacoes." }

Step "Publicando send-whatsapp (link de acompanhamento e avaliacao)"
npx supabase functions deploy send-whatsapp --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar send-whatsapp." }

Write-Host ""
Write-Host "O robo do WhatsApp (zapi-webhook) vai junto com a IA E com as mudancas da Evolution" -ForegroundColor Yellow
Write-Host "que estao no seu computador (menu numerado, boas-vindas, etc.)." -ForegroundColor Yellow
$resp = Read-Host "Publicar o robo do WhatsApp agora? (s/N)"
if ($resp -match '^(s|sim|y|yes)$') {
  Step "Publicando zapi-webhook"
  npx supabase functions deploy zapi-webhook --project-ref $ProjectRef --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { Fail "Falha ao publicar zapi-webhook (o resto ja esta no ar)." }
} else {
  Write-Host "Robo do WhatsApp NAO publicado. A IA so funciona depois dele." -ForegroundColor Yellow
}

# Conferencia ------------------------------------------------------------------------------
Step "Conferindo"
npx supabase db query --linked "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('insumos','avaliacoes','marketing_automacoes','marketing_envios')) as tabelas_novas, (select count(*) from cron.job where jobname='marketing_automacoes_horario') as cron_marketing"

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Green
Write-Host "  - Painel: menus 'Estoque & Lucro' e 'Marketing automatico' (publique o front na Vercel)."
Write-Host "  - Automacoes e IA comecam DESLIGADAS: ligue em Marketing automatico."
Write-Host "  - Link de acompanhamento e pedido de avaliacao ja vao nas mensagens do WhatsApp."
