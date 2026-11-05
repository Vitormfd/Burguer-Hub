import type { ReactNode } from "react";
import { PRECO_ASSINATURA } from "@/lib/assinatura";

// Quem responde pelo serviço: nome e contato. Para vendas online, o Decreto 7.962/2013 pede também
// razão social, CNPJ e endereço em local visível; acrescente aqui quando quiser.
const RESPONSAVEL = "Easy System";
const CONTATO = "contato@easyfoodhub.com.br";
const ATUALIZADO_EM = "5 de novembro de 2026";

function Pagina({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-foreground">
      <a href="/" className="text-sm text-primary underline">Easy Food Hub</a>
      <h1 className="mt-4 font-display text-4xl">{titulo}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Atualizado em {ATUALIZADO_EM}</p>
      <div className="mt-6 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}

export function Privacidade() {
  return (
    <Pagina titulo="Política de Privacidade">
      <p>
        Esta política explica como o Easy Food Hub, da {RESPONSAVEL}, trata dados pessoais, conforme a Lei Geral de
        Proteção de Dados (LGPD). Fale conosco em <a className="underline" href={`mailto:${CONTATO}`}>{CONTATO}</a>.
      </p>

      <h2>Dados de quem contrata o sistema</h2>
      <ul>
        <li>Cadastro: nome da loja, e-mail, senha (guardada de forma cifrada) e WhatsApp da loja.</li>
        <li>Origem do cadastro: campanha e anúncio de onde a pessoa veio (UTMs e fbclid).</li>
        <li>Pagamento: feito na Stripe. Não recebemos nem guardamos o número do cartão.</li>
      </ul>
      <p>Usamos esses dados para criar e manter a conta, dar suporte, falar sobre o teste e a assinatura e medir nossos anúncios.</p>

      <h2>Dados dos clientes dos restaurantes</h2>
      <p>
        Nome, telefone, endereço e pedidos dos clientes de cada loja são registrados para que o pedido aconteça. Nesses
        dados, a loja é a controladora e o Easy Food Hub atua como operador, seguindo as instruções da loja.
      </p>

      <h2>Cookies e Pixel do Meta</h2>
      <p>
        Nas páginas de venda, no cadastro e no painel usamos o Pixel do Meta, com cookies, para medir visitas, cliques no
        WhatsApp, cadastros e assinaturas, e para mostrar anúncios. Não enviamos e-mail ou telefone ao Meta por esse pixel.
        O pixel não é usado no cardápio público dos restaurantes nem na página de acompanhamento do pedido.
      </p>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>Supabase e Vercel: hospedagem do sistema e do banco de dados.</li>
        <li>Stripe: cobrança da assinatura.</li>
        <li>Mercado Pago: Pix, quando a loja ativa esse pagamento.</li>
        <li>Z-API, Evolution API e WhatsApp: mensagens, quando a loja conecta o WhatsApp.</li>
        <li>Anthropic: texto das mensagens e cardápio, quando a loja liga o atendimento com IA.</li>
        <li>Meta: dados de navegação e eventos, como descrito acima.</li>
      </ul>

      <h2>Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção ou exclusão dos seus dados e revogar consentimentos pelo e-mail acima. Mantemos os
        dados enquanto a conta existir e pelo tempo exigido por lei.
      </p>
    </Pagina>
  );
}

export function Termos() {
  return (
    <Pagina titulo="Termos de Uso">
      <p>
        Ao criar uma conta no Easy Food Hub, da {RESPONSAVEL}, você concorda com estes termos. Dúvidas:{" "}
        <a className="underline" href={`mailto:${CONTATO}`}>{CONTATO}</a>.
      </p>

      <h2>Teste grátis</h2>
      <p>
        Contas novas têm 7 dias grátis, sem cartão, para receber pedidos, abrir mesas e usar o cardápio online. WhatsApp
        automático, IA e marketing não fazem parte do teste. Ao terminar, a conta volta ao modo demonstração: os dados
        continuam guardados, mas pedidos, mesas e cardápio público ficam bloqueados até a assinatura.
      </p>

      <h2>Assinatura</h2>
      <p>
        A assinatura custa {PRECO_ASSINATURA}, cobrada pela Stripe de forma recorrente até o cancelamento. A cobrança começa
        quando você assina, mesmo que ainda restem dias de teste. O Easy Food Hub não cobra comissão sobre os pedidos feitos
        no cardápio digital. Taxas de terceiros, como as do Mercado Pago no Pix, são da loja com esses serviços.
      </p>

      <h2>WhatsApp</h2>
      <p>
        A conexão do WhatsApp usa serviços que não são a API oficial do WhatsApp, e o número conectado pode ser restringido
        ou bloqueado pelo próprio WhatsApp. Use um número da loja, envie mensagens apenas a quem autorizou e avalie esse
        risco antes de conectar.
      </p>

      <h2>Responsabilidades</h2>
      <p>
        A própria loja cadastra e mantém o cardápio, os preços e as informações do estabelecimento, e responde por eles,
        pelos produtos entregues e pelos dados dos próprios clientes. Podemos suspender contas usadas para fraude, spam ou atividades ilegais.
      </p>
    </Pagina>
  );
}
