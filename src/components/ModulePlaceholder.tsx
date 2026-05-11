import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function ModulePlaceholder({ icon: Icon, title, description }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-5xl text-foreground">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed shadow-card min-h-[400px]">
        <div className="bg-gradient-primary p-4 rounded-2xl shadow-elegant mb-4">
          <Icon className="w-10 h-10 text-primary-foreground" />
        </div>
        <h2 className="font-display text-2xl mb-2">Em construção</h2>
        <p className="text-muted-foreground max-w-md">
          Este módulo será implementado em breve. O backend já está configurado e pronto para receber a interface.
        </p>
      </Card>
    </div>
  );
}
