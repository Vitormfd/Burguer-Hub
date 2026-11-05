import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { registrarPagina } from "@/lib/metaPixel";

/** Registra a visita a cada troca de rota. */
export function RastreamentoMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    registrarPagina(pathname);
  }, [pathname]);
  return null;
}
