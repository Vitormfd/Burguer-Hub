# Troca a ANTHROPIC_API_KEY das Edge Functions (IA do robo do WhatsApp e agente de prospeccao).
# Uso: .\scripts\definir-chave-anthropic.ps1
#
# Testa a chave na API da Anthropic ANTES de salvar: uma chave invalida nunca chega ao Supabase.
# A chave nao aparece na tela nem fica salva em arquivo.

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$Modelo = "claude-opus-5-5"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

function Read-Secret($nome) {
  $secure = Read-Host $nome -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# Retorna "" se a chave funciona com o modelo usado, ou o motivo da recusa.
function Test-AnthropicKey($key) {
  if ($key -notmatch '^sk-ant-') { return "nao parece uma chave da Anthropic (deve comecar com sk-ant-)" }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    Invoke-RestMethod -Uri "https://api.anthropic.com/v1/models/$Modelo" -Headers @{ "x-api-key" = $key; "anthropic-version" = "2023-06-01" } | Out-Null
    return ""
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) { return "chave invalida ou revogada (401)" }
    if ($status -eq 403) { return "chave sem permissao (403)" }
    if ($status -eq 404) { return "a conta nao tem acesso ao modelo $Modelo (404)" }
    return "erro ao testar ($status): $($_.Exception.Message)"
  }
}

Step "Chave da Anthropic"
Write-Host "Crie ou copie em: https://console.anthropic.com/settings/keys (comeca com sk-ant-)." -ForegroundColor Yellow
$key = ""
for ($i = 1; $i -le 3; $i++) {
  $key = (Read-Secret "ANTHROPIC_API_KEY").Trim()
  $erro = Test-AnthropicKey $key
  if (-not $erro) { break }
  Write-Host "Chave recusada: $erro. Tente de novo." -ForegroundColor Red
  $key = ""
}
if (-not $key) { Fail "Nenhuma chave valida. Nada foi alterado no Supabase." }
Write-Host "Chave testada e aceita pela Anthropic (modelo $Modelo)." -ForegroundColor Green

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

Step "Salvando a chave nas Edge Functions"
npx supabase secrets set --project-ref $ProjectRef "ANTHROPIC_API_KEY=$key"
$ok = ($LASTEXITCODE -eq 0)
$key = $null
if (-not $ok) { Fail "Falha ao salvar a chave." }

Write-Host ""
Write-Host "Pronto! A IA do WhatsApp e o agente de prospeccao ja usam a chave nova." -ForegroundColor Green
Write-Host "No painel de prospeccao, clique em 'Executar agora' para testar."
