import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Utensils } from "lucide-react";
import { requestDesktopNotificationPermission, tryUnlockAudio } from "@/lib/sound";
import { PRECO_ASSINATURA, whatsappValido } from "@/lib/assinatura";
import { registrarEventoUnico } from "@/lib/metaPixel";
import { capturarOrigem } from "@/lib/origemAnuncio";

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, loading } = useAuth();
  const [aba, setAba] = useState(searchParams.get("mode") === "signup" ? "signup" : "login");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const recemCadastrado = useRef(false);

  useEffect(() => {
    if (!loading && session && !recemCadastrado.current) navigate("/", { replace: true });
  }, [session, loading, navigate]);

  // O anúncio pode trazer a pessoa direto para esta tela.
  useEffect(() => {
    capturarOrigem();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    await tryUnlockAudio();
    void requestDesktopNotificationPermission();
    toast.success("Bem-vindo!");
    navigate("/", { replace: true });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const contato = whatsappValido(whatsapp);
    if (!contato) return toast.error("Informe o WhatsApp da loja com DDD");

    setBusy(true);
    recemCadastrado.current = true;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { nome, whatsapp: contato, origem: capturarOrigem() },
      },
    });
    setBusy(false);

    // Com a confirmação de e-mail ligada, o Supabase responde sucesso para e-mail já
    // cadastrado, com a lista de identidades vazia. Não é conta nova: nada de evento.
    const emailJaExiste =
      error?.code === "user_already_exists" || (!error && data.user?.identities?.length === 0);
    if (emailJaExiste) {
      recemCadastrado.current = false;
      setAba("login");
      return toast.error("Este e-mail já tem conta. Entre com a sua senha.");
    }
    if (error || !data.user) {
      recemCadastrado.current = false;
      return toast.error(error?.message || "Não foi possível criar a conta");
    }

    registrarEventoUnico("CompleteRegistration", data.user.id);
    registrarEventoUnico("StartTrial", data.user.id);

    if (!data.session) {
      recemCadastrado.current = false;
      setAba("login");
      return toast.success("Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.");
    }

    await tryUnlockAudio();
    toast.success("Conta criada! Comece montando o seu cardápio.");
    navigate("/admin/cardapio", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md p-8 shadow-elegant">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-primary p-3 rounded-2xl mb-4 shadow-elegant">
            <Utensils className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-display text-foreground">Easy Food Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestão para restaurantes e food service</p>
        </div>

        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Testar grátis</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-pass">Senha</Label>
                <Input id="login-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy} size="lg">
                {busy ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <p className="mb-4 text-sm text-muted-foreground">
              7 dias grátis, sem cartão, recebendo pedidos de verdade. Depois, {PRECO_ASSINATURA}.
            </p>
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-nome">Nome da loja</Label>
                <Input id="signup-nome" autoComplete="organization" required value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-whatsapp">WhatsApp da loja</Label>
                <Input
                  id="signup-whatsapp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(74) 99999-0000"
                  required
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input id="signup-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-pass">Senha</Label>
                <Input id="signup-pass" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy} size="lg">
                {busy ? "Criando..." : "Começar teste grátis"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Ao criar a conta, você concorda com os{" "}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="underline">Termos de Uso</a> e a{" "}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">Política de Privacidade</a>.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
