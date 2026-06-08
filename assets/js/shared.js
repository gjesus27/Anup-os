export const SUPPORT_EMAIL = "g.jesus140606@gmail.com";

export const USER_ROLES = [
  { value: "suporte", label: "Dono Anup OS" },
  { value: "assistencia_admin", label: "Admin da assistência" },
  { value: "loja_admin", label: "Admin da loja" },
  { value: "gerente", label: "Gerente" },
  { value: "tecnico", label: "Técnico" },
  { value: "financeiro", label: "Financeiro" },
  { value: "leitura", label: "Somente leitura" },
];

export const DEFAULT_STORE = {
  name: "Anup OS",
  address: "",
  whatsapp: "5599999999999",
  warrantyDays: 90,
};

export const STATUSES = [
  "Aguardando análise",
  "Orçamento enviado",
  "Aguardando aprovação",
  "Aprovado",
  "Em conserto",
  "Aguardando peça",
  "Finalizado",
  "Entregue",
  "Cancelado",
];

export const ACTIVE_STATUSES = [
  "Aguardando análise",
  "Orçamento enviado",
  "Aguardando aprovação",
  "Aprovado",
  "Em conserto",
  "Aguardando peça",
];

export const DONE_STATUSES = ["Finalizado", "Entregue"];

export function storeName(store) {
  return store?.nome || store?.lojaNome || store?.name || DEFAULT_STORE.name;
}

export function storeAddress(store) {
  return store?.endereco || store?.lojaEndereco || store?.address || DEFAULT_STORE.address;
}

export function storeWhatsapp(store) {
  return store?.whatsapp || store?.lojaWhatsapp || store?.phone || DEFAULT_STORE.whatsapp;
}

export function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function parseCurrency(value) {
  if (typeof value === "number") return value;
  const clean = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Number(clean) || 0;
}

export function formatDate(value) {
  if (!value) return "Sem previsão";
  if (value.toDate) return value.toDate().toLocaleDateString("pt-BR");
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Sem previsão" : date.toLocaleDateString("pt-BR");
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export function maskPhone(value) {
  const digits = normalizePhone(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{0,2})(\d{0,4})(\d{0,4})/, (_, ddd, p1, p2) =>
      [ddd && `(${ddd}`, ddd && ") ", p1, p2 && `-${p2}`].filter(Boolean).join("")
    );
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

export function whatsappLink(phone, message) {
  let digits = normalizePhone(phone);
  if (digits.length <= 11 && !digits.startsWith("55")) digits = `55${digits}`;
  return `https://wa.me/${digits || DEFAULT_STORE.whatsapp}?text=${encodeURIComponent(message)}`;
}

export function publicOrderUrl(id) {
  const path = window.location.pathname.replace(/\/[^/]*$/, "/os.html");
  return `${window.location.origin}${path}?id=${id}`;
}

export function statusClass(status) {
  const map = {
    "Aguardando análise": "status-blue",
    "Orçamento enviado": "status-indigo",
    "Aguardando aprovação": "status-violet",
    Aprovado: "status-emerald",
    "Em conserto": "status-amber",
    "Aguardando peça": "status-orange",
    Finalizado: "status-green",
    Entregue: "status-slate",
    Cancelado: "status-red",
  };
  return map[status] || "status-slate";
}

export function statusMessage(order, url, store = DEFAULT_STORE) {
  const name = storeName(store);
  const address = storeAddress(store);
  const base = `Olá, ${order.clienteNome}! Aqui é a ${name}.`;
  const device = `${order.marca || ""} ${order.modelo || ""}`.trim();
  const messages = {
    "Orçamento enviado": `${base}\n\nEnviamos o orçamento da OS ${order.numeroOS} para o aparelho ${device}. Valor: ${currency(order.valorTotal)}.\n\nAcompanhe por aqui: ${url}\n\nEndereço: ${address}`,
    "Em conserto": `${base}\n\nSua OS ${order.numeroOS} foi aprovada e o aparelho ${device} está em conserto.\n\nAcompanhe por aqui: ${url}\n\n${name}`,
    Finalizado: `${base}\n\nBoa notícia: a OS ${order.numeroOS} foi finalizada. Seu aparelho ${device} está pronto para retirada.\n\nValor total: ${currency(order.valorTotal)}\nEndereço: ${address}\n\nAcompanhe: ${url}`,
    Entregue: `${base}\n\nRegistramos a entrega da OS ${order.numeroOS}. A garantia do serviço é de ${order.garantiaDias || 90} dias.\n\nObrigado pela confiança!\n${name}`,
    Cancelado: `${base}\n\nA OS ${order.numeroOS} foi cancelada. Se precisar de qualquer ajuste ou nova avaliação, fale conosco.\n\n${name}`,
  };
  return messages[order.status] || `${base}\n\nA OS ${order.numeroOS} teve atualização de status: ${order.status}.\n\nAcompanhe por aqui: ${url}\n\n${name}`;
}

export function quoteMessage(order, url, store = DEFAULT_STORE) {
  const name = storeName(store);
  const address = storeAddress(store);
  const device = `${order.marca || ""} ${order.modelo || ""}`.trim();
  const valueLine = order.valorTotal ? `\nValor do orçamento: ${currency(order.valorTotal)}` : "";
  return `Olá, ${order.clienteNome}! Tudo bem?\n\nSua ordem de serviço foi cadastrada na ${name}.\n\nOS: ${order.numeroOS}\nAparelho: ${device}\nDefeito relatado: ${order.defeitoRelatado || "Não informado"}${valueLine}\n\nAcompanhe o andamento pelo link:\n${url}\n\nEndereço: ${address}\n\n${name}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
