import { useEffect } from "react";

// A landing page é mantida no Base44 e publicada na Vercel. Aqui ela aparece no domínio do
// sistema (easyfoodhub.com.br/lp). O roteador dela só aceita "/", por isso é exibida em
// iframe em vez de um rewrite; os links de WhatsApp dela já abrem em nova aba.
export const LANDING_PAGE_URL = "https://easy-food-hub-lp.vercel.app/";

export default function LandingPage() {
  useEffect(() => {
    const anterior = document.title;
    document.title = "Easy Food Hub | Sistema para Restaurantes, Delivery e Negócios de Alimentação";
    return () => {
      document.title = anterior;
    };
  }, []);

  return (
    <iframe
      src={LANDING_PAGE_URL}
      title="Easy Food Hub"
      className="fixed inset-0 h-[100dvh] w-full border-0"
      allow="clipboard-write"
    />
  );
}
