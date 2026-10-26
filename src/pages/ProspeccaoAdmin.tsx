import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProspectDetalhe } from "@/components/prospeccao/ProspectDetalhe";
import { ProspeccaoConfig } from "@/components/prospeccao/ProspeccaoConfig";
import { ProspeccaoExecucoes } from "@/components/prospeccao/ProspeccaoExecucoes";
import { ProspeccaoFila } from "@/components/prospeccao/ProspeccaoFila";
import { ProspeccaoLista } from "@/components/prospeccao/ProspeccaoLista";
import { ProspeccaoPainel } from "@/components/prospeccao/ProspeccaoPainel";
import { sb } from "@/lib/prospeccao";

export default function ProspeccaoAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const mudou = () => setVersao((v) => v + 1);

  useEffect(() => {
    void sb.rpc("is_prospeccao_admin").then(({ data }: { data: boolean | null }) => setAdmin(Boolean(data)));
  }, []);

  if (admin === null) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!admin) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Esta área é só para o administrador do Easy Food Hub. Se for você, rode o script de deploy da prospecção e informe o
        e-mail da sua conta quando ele pedir.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-foreground">Prospecção</h1>
        <p className="text-muted-foreground mt-1">
          O agente encontra hamburguerias, pizzarias e outros negócios pelo Brasil, identifica quem usa Anota AI ou não tem
          sistema, e prepara a abordagem. Você envia o primeiro contato; a IA cuida das respostas.
        </p>
      </div>

      <Tabs defaultValue="painel">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="fila">Fila de contato</TabsTrigger>
          <TabsTrigger value="prospects">Estabelecimentos</TabsTrigger>
          <TabsTrigger value="execucoes">Execuções</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="mt-4">
          <ProspeccaoPainel versao={versao} onMudou={mudou} />
        </TabsContent>
        <TabsContent value="fila" className="mt-4">
          <ProspeccaoFila onAbrir={setAberto} versao={versao} />
        </TabsContent>
        <TabsContent value="prospects" className="mt-4">
          <ProspeccaoLista onAbrir={setAberto} versao={versao} />
        </TabsContent>
        <TabsContent value="execucoes" className="mt-4">
          <ProspeccaoExecucoes versao={versao} />
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          <ProspeccaoConfig onSalvo={mudou} />
        </TabsContent>
      </Tabs>

      <ProspectDetalhe prospectId={aberto} onClose={() => setAberto(null)} onChange={mudou} />
    </div>
  );
}
