import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Settings, Plus, Trash2, ExternalLink, Upload, X } from "lucide-react";
import { useRef } from "react";
import type { BairroTaxa, Configuracao } from "@/types/db";
import { brl } from "@/lib/format";
import { Link } from "react-router-dom";

export default function Configuracoes() {
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [bairros, setBairros] = useState<BairroTaxa[]>([]);
  const [novoBairro, setNovoBairro] = useState("");
  const [novaTaxa, setNovaTaxa] = useState("");
  const [novaImagemCarrossel, setNovaImagemCarrossel] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | "carrossel" | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const carrosselRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (kind: "logo" | "banner", file: File) => {
    if (!cfg) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Arquivo deve ter até 5MB");
    setUploading(kind);
    const ext = file.name.split(".").pop() || "png";
    const path = `${kind}-${cfg.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("loja").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploading(null); return toast.error(upErr.message); }
    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    const url = data.publicUrl;
    const { error: saveErr } = await supabase
      .from("configuracoes")
      .update({ [kind === "logo" ? "logo_url" : "banner_url"]: url } as any)
      .eq("id", cfg.id);
    if (saveErr) { setUploading(null); return toast.error(saveErr.message); }
    setCfg({ ...cfg, [kind === "logo" ? "logo_url" : "banner_url"]: url });
    setUploading(null);
    toast.success(`${kind === "logo" ? "Logo" : "Banner"} salvo`);
  };

  const load = async () => {
    const [{ data: c }, { data: b }] = await Promise.all([
      supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
      supabase.from("bairros_taxas").select("*").order("nome"),
    ]);
    if (c) {
      const cfgData = c as Configuracao;
      setCfg({
        ...cfgData,
        carrossel_imagens: cfgData.carrossel_imagens || [],
      });
    }
    setBairros((b || []) as BairroTaxa[]);
  };
  useEffect(() => { load(); }, []);

  const uploadCarouselImage = async (file: File) => {
    if (!cfg) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Arquivo deve ter até 5MB");

    setUploading("carrossel");
    const ext = file.name.split(".").pop() || "png";
    const path = `carrossel-${cfg.id}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage.from("loja").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (upErr) {
      setUploading(null);
      return toast.error(upErr.message);
    }

    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    const url = data.publicUrl;
    setCfg({
      ...cfg,
      carrossel_imagens: [...(cfg.carrossel_imagens || []), url],
    });
    setUploading(null);
    toast.success("Imagem adicionada ao carrossel");
  };

  const addCarouselByUrl = () => {
    if (!cfg) return;
    const url = novaImagemCarrossel.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return toast.error("Informe uma URL válida iniciando com http:// ou https://");

    const atuais = cfg.carrossel_imagens || [];
    if (atuais.includes(url)) return toast.error("Essa imagem já está no carrossel");

    setCfg({ ...cfg, carrossel_imagens: [...atuais, url] });
    setNovaImagemCarrossel("");
  };

  const removeCarouselImage = (url: string) => {
    if (!cfg) return;
    setCfg({
      ...cfg,
      carrossel_imagens: (cfg.carrossel_imagens || []).filter((item) => item !== url),
    });
  };

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({
        nome_loja: cfg.nome_loja,
        logo_url: cfg.logo_url,
        banner_url: cfg.banner_url,
        cor_primaria: cfg.cor_primaria,
        ativo: cfg.ativo,
        hora_abertura: cfg.hora_abertura,
        hora_fechamento: cfg.hora_fechamento,
        seo_titulo: cfg.seo_titulo,
        seo_descricao: cfg.seo_descricao,
        tempo_entrega_min: cfg.tempo_entrega_min ?? "30-45 min",
        carrossel_imagens: cfg.carrossel_imagens || [],
      })
      .eq("id", cfg.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Configurações salvas");
  };

  const addBairro = async () => {
    const taxa = Number(novaTaxa.replace(",", ".")) || 0;
    if (!novoBairro.trim()) return;
    const { error } = await supabase.from("bairros_taxas").insert({ nome: novoBairro.trim(), taxa });
    if (error) return toast.error(error.message);
    setNovoBairro(""); setNovaTaxa("");
    load();
  };

  const removeBairro = async (id: string) => {
    const { error } = await supabase.from("bairros_taxas").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  if (!cfg) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-5xl flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" /> Configurações
          </h1>
          <p className="text-muted-foreground mt-1">Identidade, horário e bairros do delivery online</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/cardapio" target="_blank"><ExternalLink className="w-4 h-4 mr-1" /> Ver página pública</Link>
        </Button>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-2xl">Identidade da loja</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nome da loja</Label>
            <Input value={cfg.nome_loja} maxLength={80} onChange={(e) => setCfg({ ...cfg, nome_loja: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Cor principal</Label>
            <div className="flex gap-2">
              <Input type="color" value={cfg.cor_primaria} onChange={(e) => setCfg({ ...cfg, cor_primaria: e.target.value })} className="w-20 h-10 p-1" />
              <Input value={cfg.cor_primaria} onChange={(e) => setCfg({ ...cfg, cor_primaria: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2 md:col-span-2 grid md:grid-cols-2 gap-4">
            {(["logo", "banner"] as const).map((kind) => {
              const url = kind === "logo" ? cfg.logo_url : cfg.banner_url;
              const ref = kind === "logo" ? logoRef : bannerRef;
              const setUrl = (v: string | null) => setCfg({ ...cfg, [kind === "logo" ? "logo_url" : "banner_url"]: v });
              return (
                <div key={kind} className="space-y-2">
                  <Label>{kind === "logo" ? "Logo" : "Banner"}</Label>
                  {url && (
                    <div className="relative w-full rounded-md overflow-hidden border bg-muted" style={{ aspectRatio: kind === "logo" ? "1 / 1" : "16 / 6", maxHeight: kind === "logo" ? 120 : 160 }}>
                      <img src={url} alt={kind} className="w-full h-full object-cover" />
                      <Button type="button" size="icon" variant="destructive" className="absolute top-1 right-1 h-7 w-7" onClick={() => setUrl(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      ref={ref}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadFile(kind, f);
                        e.target.value = "";
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => ref.current?.click()} disabled={uploading === kind}>
                      <Upload className="w-4 h-4 mr-1" /> {uploading === kind ? "Enviando..." : "Enviar arquivo"}
                    </Button>
                  </div>
                  <Input
                    value={url ?? ""}
                    onChange={(e) => setUrl(e.target.value || null)}
                    placeholder="ou cole uma URL https://..."
                  />
                </div>
              );
            })}
          </div>

          <div className="space-y-3 md:col-span-2">
            <Label>Imagens do carrossel do topo</Label>
            <p className="text-xs text-muted-foreground">
              Essas imagens são exibidas no carrossel grande da página pública.
            </p>

            {(cfg.carrossel_imagens || []).length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Nenhuma imagem adicionada no carrossel ainda.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(cfg.carrossel_imagens || []).map((url, idx) => (
                  <div key={`${url}-${idx}`} className="relative rounded-md overflow-hidden border bg-muted" style={{ aspectRatio: "16 / 8.8" }}>
                    <img src={url} alt={`Carrossel ${idx + 1}`} className="w-full h-full object-cover" />
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="absolute top-1 right-1 h-7 w-7"
                      onClick={() => removeCarouselImage(url)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                ref={carrosselRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadCarouselImage(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" onClick={() => carrosselRef.current?.click()} disabled={uploading === "carrossel"}>
                <Upload className="w-4 h-4 mr-1" /> {uploading === "carrossel" ? "Enviando..." : "Adicionar imagem"}
              </Button>
            </div>

            <div className="flex gap-2">
              <Input
                value={novaImagemCarrossel}
                onChange={(e) => setNovaImagemCarrossel(e.target.value)}
                placeholder="ou cole uma URL da imagem https://..."
              />
              <Button type="button" variant="secondary" onClick={addCarouselByUrl}>Adicionar URL</Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-2xl">Funcionamento</h2>
        <div className="grid md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <Label>Página pública ativa</Label>
            <div className="flex items-center gap-2 h-10">
              <Switch checked={cfg.ativo} onCheckedChange={(v) => setCfg({ ...cfg, ativo: v })} />
              <span className="text-sm text-muted-foreground">{cfg.ativo ? "Aceitando pedidos" : "Fechada"}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Abertura</Label>
            <Input type="time" value={cfg.hora_abertura.slice(0, 5)} onChange={(e) => setCfg({ ...cfg, hora_abertura: e.target.value + ":00" })} />
          </div>
          <div className="space-y-2">
            <Label>Fechamento</Label>
            <Input type="time" value={cfg.hora_fechamento.slice(0, 5)} onChange={(e) => setCfg({ ...cfg, hora_fechamento: e.target.value + ":00" })} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Tempo estimado de entrega</Label>
          <Input
            value={cfg.tempo_entrega_min ?? ""}
            onChange={(e) => setCfg({ ...cfg, tempo_entrega_min: e.target.value })}
            maxLength={30}
            placeholder="Ex: 30-45 min"
          />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-2xl">SEO</h2>
        <div className="space-y-2">
          <Label>Título da página</Label>
          <Input value={cfg.seo_titulo} maxLength={60} onChange={(e) => setCfg({ ...cfg, seo_titulo: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Meta description</Label>
          <Textarea rows={2} value={cfg.seo_descricao} maxLength={160} onChange={(e) => setCfg({ ...cfg, seo_descricao: e.target.value })} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-2xl">Bairros e taxas de entrega</h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-2">
            <Label>Bairro</Label>
            <Input value={novoBairro} onChange={(e) => setNovoBairro(e.target.value)} placeholder="Ex: Centro" />
          </div>
          <div className="w-32 space-y-2">
            <Label>Taxa (R$)</Label>
            <Input type="number" min={0} step="0.50" value={novaTaxa} onChange={(e) => setNovaTaxa(e.target.value)} />
          </div>
          <Button onClick={addBairro}><Plus className="w-4 h-4 mr-1" /> Adicionar</Button>
        </div>
        <div className="divide-y border rounded-lg">
          {bairros.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">Nenhum bairro cadastrado</div>
          ) : bairros.map((b) => (
            <div key={b.id} className="flex items-center justify-between px-4 py-2">
              <span className="font-medium">{b.nome}</span>
              <div className="flex items-center gap-3">
                <span className="text-primary font-semibold">{brl(Number(b.taxa))}</span>
                <Button variant="ghost" size="icon" onClick={() => removeBairro(b.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={save} disabled={busy}>{busy ? "Salvando..." : "Salvar configurações"}</Button>
      </div>
    </div>
  );
}
