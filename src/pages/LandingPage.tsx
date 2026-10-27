import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// A página de vendas é HTML puro em public/sistema-para-restaurante (o Google lê sem JavaScript).
// Na Vercel, /lp já redireciona antes de chegar aqui (vercel.json); isto cobre o dev e links antigos.
export const PAGINA_DE_VENDAS = "/sistema-para-restaurante";

/** Sai do app para uma página estática (fora do React Router). */
export function IrParaPagina({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}

/** Raiz do domínio: quem está logado vai para o sistema; visitante (e o Google) vê a página de vendas. */
export function Inicio() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/mesas" replace />;
  return <IrParaPagina to={PAGINA_DE_VENDAS} />;
}
