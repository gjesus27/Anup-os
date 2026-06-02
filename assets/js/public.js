import { currency, escapeHtml, formatDate, statusClass, storeAddress, storeName, storeWhatsapp, whatsappLink } from "./shared.js";
import { db, doc, getDoc } from "./firebase.js";

const params = new URLSearchParams(window.location.search);
const id = params.get("id");
const loading = document.querySelector("#publicLoading");
const empty = document.querySelector("#publicEmpty");
const orderBox = document.querySelector("#publicOrder");
const fallback = document.querySelector("#fallbackWhatsapp");

fallback.href = whatsappLink("", "Olá! Gostaria de consultar uma ordem de serviço.");

function publicMessage(order) {
  return `Olá! Gostaria de falar sobre a OS ${order.numeroOS} do aparelho ${order.marca || ""} ${order.modelo || ""}.`;
}

function showEmpty() {
  loading.classList.add("hidden");
  empty.classList.remove("hidden");
}

function render(order) {
  const device = `${order.marca || ""} ${order.modelo || ""}`.trim();
  const store = {
    nome: order.lojaNome,
    endereco: order.lojaEndereco,
    whatsapp: order.lojaWhatsapp,
  };
  document.querySelector(".brand-title").textContent = storeName(store);
  document.querySelector(".public-hero h1").textContent = "Acompanhe sua ordem de serviço";
  document.querySelector(".public-hero p").textContent = "Consulte o andamento do reparo com segurança e fale com a loja quando precisar.";
  fallback.href = whatsappLink(storeWhatsapp(store), `Olá! Gostaria de consultar uma ordem de serviço na ${storeName(store)}.`);

  orderBox.innerHTML = `
    <div class="public-order-head">
      <div>
        <p class="eyebrow">Ordem de Serviço</p>
        <h2>${escapeHtml(order.numeroOS)}</h2>
      </div>
      <span class="status-badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
    </div>

    <div class="public-progress">
      ${["Aguardando análise", "Orçamento enviado", "Aprovado", "Em conserto", "Finalizado", "Entregue"]
        .map((status) => `<span class="${status === order.status ? "current" : ""}">${escapeHtml(status)}</span>`)
        .join("")}
    </div>

    <div class="public-grid">
      ${item("Cliente", order.clienteNome)}
      ${item("Aparelho", device)}
      ${item("Defeito informado", order.defeitoRelatado)}
      ${item("Valor total", currency(order.valorTotal))}
      ${item("Previsão de entrega", formatDate(order.previsaoEntrega))}
      ${item("Garantia", `${order.garantiaDias || 90} dias`)}
      ${item("Endereço da loja", storeAddress(store))}
    </div>

    <a class="btn btn-whatsapp public-whatsapp" href="${whatsappLink(storeWhatsapp(store), publicMessage(order))}" target="_blank" rel="noreferrer">
      <i class="fa-brands fa-whatsapp"></i>
      Chamar loja no WhatsApp
    </a>
  `;
  loading.classList.add("hidden");
  orderBox.classList.remove("hidden");
}

function item(label, value) {
  return `<div class="public-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Não informado")}</strong></div>`;
}

async function init() {
  if (!id) {
    showEmpty();
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "public_ordens", id));
    if (!snapshot.exists()) {
      showEmpty();
      return;
    }
    render(snapshot.data());
  } catch (error) {
    showEmpty();
  }
}

init();
