import { Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  onAbrir: () => void;
};

export default function CaixaFechadoBanner({ onAbrir }: Props) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 [&>svg]:text-amber-700">
      <Wallet className="h-4 w-4" />
      <AlertTitle>Caixa fechado</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>Abra o caixa antes de iniciar as vendas do dia para manter o controle financeiro.</span>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-600/40 bg-background/80 hover:bg-background"
          onClick={onAbrir}
        >
          Abrir caixa
        </Button>
      </AlertDescription>
    </Alert>
  );
}
