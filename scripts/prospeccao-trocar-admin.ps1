# Troca o administrador da prospeccao: adiciona a sua conta e remove a conta demo.
# Uso: .\scripts\prospeccao-trocar-admin.ps1
# A conta demo so e removida se a conta nova existir (nunca fica sem administrador).
# Opcional: -Email voce@exemplo.com (senao o script pergunta).

param([string]$Email = "")

$ErrorActionPreference = "Stop"
$ProjectRef = "iehcswmrufrpbvnwldkw"
$DemoEmail = "demo@easyfoodhub.com.br"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

function Run-Sql($sql) {
  $tmp = Join-Path $env:TEMP ("efh-admin-" + [guid]::NewGuid().ToString("N") + ".sql")
  try {
    [IO.File]::WriteAllText($tmp, $sql)
    npx supabase db query --linked --file $tmp
    return ($LASTEXITCODE -eq 0)
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

Step "Conectando ao projeto Supabase $ProjectRef"
$ErrorActionPreference = "Continue"
npx supabase link --project-ref $ProjectRef 2>&1 | Out-Host
$linked = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"
if (-not $linked) {
  Write-Host "Cole um Access Token da conta DONA do projeto (https://supabase.com/dashboard/account/tokens)." -ForegroundColor Yellow
  $secure = Read-Host "SUPABASE_ACCESS_TOKEN" -AsSecureString
  $env:SUPABASE_ACCESS_TOKEN = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))).Trim()
  npx supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Fail "Sem acesso ao projeto $ProjectRef. Nada foi alterado." }
}

Step "Nova conta administradora"
if ($Email) {
  $email = $Email.Trim().ToLower()
  Write-Host "E-mail: $email"
} else {
  Write-Host "E-mail da SUA conta no Easy Food Hub (a que voce usa para entrar no painel)." -ForegroundColor Yellow
  $email = (Read-Host "E-mail").Trim().ToLower()
}
if ($email -notmatch '^[^@\s'']+@[^@\s'']+\.[^@\s'']+$') { Fail "E-mail invalido." }
if ($email -eq $DemoEmail) { Fail "Esse e o e-mail da conta demo. Use a sua conta pessoal." }

$sql = @"
DO `$a`$
DECLARE v_novo uuid;
BEGIN
  SELECT id INTO v_novo FROM auth.users WHERE lower(email) = '$email';
  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta com o e-mail %. Cadastre-se no app e rode de novo.', '$email';
  END IF;
  INSERT INTO public.prospeccao_admins (user_id) VALUES (v_novo) ON CONFLICT (user_id) DO NOTHING;
  DELETE FROM public.prospeccao_admins a
    USING auth.users u
    WHERE u.id = a.user_id AND lower(u.email) = '$DemoEmail' AND a.user_id <> v_novo;
END
`$a`$;
SELECT u.email AS administradores FROM public.prospeccao_admins a JOIN auth.users u ON u.id = a.user_id ORDER BY 1;
"@

Step "Atualizando administradores"
if (-not (Run-Sql $sql)) { Fail "Nao foi possivel trocar o administrador. Nada foi alterado." }

Write-Host ""
Write-Host "Pronto! A lista acima deve mostrar so o seu e-mail." -ForegroundColor Green
Write-Host "Entre no painel com essa conta: o menu 'Prospeccao' aparece na barra lateral."
