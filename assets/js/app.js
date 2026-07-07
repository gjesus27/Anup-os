import {
  ACTIVE_STATUSES,
  DONE_STATUSES,
  STATUSES,
  SUPPORT_EMAIL,
  USER_ROLES,
  currency,
  escapeHtml,
  formatDate,
  maskPhone,
  normalizePhone,
  parseCurrency,
  publicOrderUrl,
  quoteMessage,
  statusClass,
  statusMessage,
  todayISO,
  whatsappLink,
} from "./shared.js";
import {
  addDoc,
  auth,
  collection,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  functions,
  httpsCallable,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  secondaryAuth,
  sendPasswordResetEmail,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
} from "./firebase.js";

const createAsaasBilling = httpsCallable(functions, "createAsaasBilling");

let orders = [];
let clients = [];
let users = [];
let stores = [];
let tenants = [];
let notices = [];
let tickets = [];
let currentUser = null;
let profile = null;
let activeStoreId = "";
let activeSupportAssistanceId = "";
let currentStatusBeforeEdit = "";
let unsubscribers = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const refs = {
  authScreen: $("#authScreen"),
  appShell: $("#appShell"),
  loginForm: $("#loginForm"),
  orderModal: $("#orderModal"),
  clientModal: $("#clientModal"),
  detailsModal: $("#detailsModal"),
  userModal: $("#userModal"),
  tenantModal: $("#tenantModal"),
  orderForm: $("#orderForm"),
  clientForm: $("#clientForm"),
  userForm: $("#userForm"),
  tenantForm: $("#tenantForm"),
  noticeForm: $("#noticeForm"),
  ticketForm: $("#ticketForm"),
  storeForm: $("#storeForm"),
  ordersTable: $("#ordersTable"),
  recentOrders: $("#recentOrders"),
  clientsList: $("#clientsList"),
  usersList: $("#usersList"),
  supportList: $("#supportList"),
  supportListCount: $("#supportListCount"),
  supportSearchInput: $("#supportSearchInput"),
  supportPaymentFilter: $("#supportPaymentFilter"),
  saasTenantsList: $("#saasTenantsList"),
  noticeList: $("#noticeList"),
  noticeTenant: $("#noticeTenant"),
  ticketList: $("#ticketList"),
  loadingState: $("#loadingState"),
  emptyState: $("#emptyState"),
  searchInput: $("#searchInput"),
  statusFilter: $("#statusFilter"),
  dateFilter: $("#dateFilter"),
  dashboardSearchInput: $("#dashboardSearchInput"),
  dashboardStatusFilter: $("#dashboardStatusFilter"),
  dashboardDateFilter: $("#dashboardDateFilter"),
  dashboardPeriodFilter: $("#dashboardPeriodFilter"),
  storeSelector: $("#storeSelector"),
};

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.innerHTML = `<i class="fa-solid ${
    type === "error" ? "fa-circle-exclamation" : "fa-circle-check"
  }"></i><span>${escapeHtml(message)}</span>`;
  $("#toastHost").appendChild(item);
  setTimeout(() => item.remove(), 3800);
}

function roleLabel(role) {
  return USER_ROLES.find((item) => item.value === role)?.label || role;
}

function isSupport() {
  return profile?.role === "suporte" || currentUser?.email?.toLowerCase() === SUPPORT_EMAIL;
}

function canManage() {
  return isSupport() || ["assistencia_admin", "loja_admin"].includes(profile?.role);
}

function isSupportInTenantContext() {
  return isSupport() && Boolean(activeSupportAssistanceId || activeStoreId);
}

function isAssistanceAdmin() {
  return profile?.role === "assistencia_admin";
}

function canWriteOrders() {
  return isSupport() || !["financeiro", "leitura"].includes(profile?.role);
}

function activeStore() {
  return stores.find((store) => store.id === activeStoreId);
}

function activeAssistance() {
  const store = activeStore();
  const assistanceId = activeSupportAssistanceId || store?.assistenciaId || profile?.assistenciaId;
  return tenants.find((tenant) => tenant.id === assistanceId);
}

function storePath(...parts) {
  return ["lojas", activeStoreId, ...parts];
}

function closeModal(id) {
  $(`#${id}`).close();
}

function cleanupSubscriptions() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function fillStatusOptions() {
  const options = STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("");
  $("#status").innerHTML = options;
  refs.statusFilter.innerHTML = `<option value="">Todos</option>${options}`;
  refs.dashboardStatusFilter.innerHTML = `<option value="">Todos</option>${options}`;
}

function fillRoleOptions() {
  $("#userRole").innerHTML = USER_ROLES.filter((role) => isSupport() || role.value !== "suporte")
    .map((role) => `<option value="${role.value}">${role.label}</option>`)
    .join("");
}

function bindNavigation() {
  $$("[data-section-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = link.dataset.sectionLink;
      if (!target) return;
      event.preventDefault();
      showSection(target);
    });
  });
}

function showSection(target) {
  if (target === "admin" && !canManage()) return;
  if (["suporte", "saas-assistencias", "saas-config"].includes(target) && !isSupport()) return;
  $$(".view-section").forEach((section) => section.classList.remove("is-visible"));
  $(`#${target}`)?.classList.add("is-visible");
  $$(".nav-link").forEach((nav) => nav.classList.toggle("active", nav.dataset.sectionLink === target));
  history.replaceState(null, "", `#${target}`);
}

function bindMasks() {
  ["#clienteWhatsapp", "#clientWhatsapp", "#storeWhatsappInput", "#tenantBillingPhone"].forEach((selector) => {
    $(selector).addEventListener("input", (event) => {
      event.target.value = maskPhone(event.target.value);
    });
  });
  $$(".money-input").forEach((input) => {
    input.addEventListener("blur", () => {
      input.value = input.value ? currency(parseCurrency(input.value)) : "";
    });
  });
  ["#valorMaoObra", "#valorPecas"].forEach((selector) => {
    $(selector).addEventListener("input", updateTotal);
    $(selector).addEventListener("blur", updateTotal);
  });
}

function updateTotal() {
  const total = parseCurrency($("#valorMaoObra").value) + parseCurrency($("#valorPecas").value);
  $("#valorTotal").value = currency(total);
}

function addDaysISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function planValue(planType, monthlyValue, oneShotValue) {
  if (planType === "unico") return Number(oneShotValue || 0);
  if (planType === "anual") return Number(monthlyValue || 0) * 12;
  return Number(monthlyValue || 0);
}

function billingTypeLabel(type) {
  return {
    UNDEFINED: "Cliente escolhe",
    PIX: "Pix",
    BOLETO: "Boleto",
    CREDIT_CARD: "Cartão recorrente",
  }[type || "UNDEFINED"];
}

async function login(event) {
  event.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (email === SUPPORT_EMAIL) {
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        return;
      } catch (createError) {
        toast("Não foi possível entrar. Confira e-mail e senha.", "error");
        return;
      }
    }
    toast("Não foi possível entrar. Confira e-mail e senha.", "error");
  }
}

async function loadProfile(user) {
  const userRef = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) return { id: user.uid, ...snapshot.data() };

  if (user.email?.toLowerCase() === SUPPORT_EMAIL) {
    const data = {
      nome: "Dono Anup OS",
      email: user.email.toLowerCase(),
      role: "suporte",
      assistenciaId: null,
      lojaIds: [],
      ativo: true,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    };
    await setDoc(userRef, data);
    return { id: user.uid, ...data };
  }

  throw new Error("Perfil de usuário não encontrado.");
}

async function loadStores() {
  if (isSupport()) {
    const snapshot = await getDocs(query(collection(db, "lojas"), orderBy("nome")));
    stores = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    activeStoreId = "";
    activeSupportAssistanceId = "";
    renderStoreSelector();
    return;
  }

  if (isAssistanceAdmin()) {
    const snapshot = await getDocs(query(collection(db, "lojas"), where("assistenciaId", "==", profile.assistenciaId), orderBy("nome")));
    stores = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } else {
    if (!profile?.lojaIds?.length) {
      stores = [];
      return;
    }
    const results = await Promise.all(profile.lojaIds.map((lojaId) => getDoc(doc(db, "lojas", lojaId))));
    stores = results.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
  }
  activeStoreId = stores[0]?.id || "";
  activeSupportAssistanceId = "";
  renderStoreSelector();
}

function renderShell() {
  refs.authScreen.classList.add("hidden");
  refs.appShell.classList.remove("hidden");
  const supportContext = isSupportInTenantContext();
  $$("[data-permission='support']").forEach((item) => item.classList.toggle("hidden", !isSupport()));
  $$("[data-permission='tenant']").forEach((item) => item.classList.toggle("hidden", isSupport() && !supportContext));
  $$("[data-permission='manage']").forEach((item) =>
    item.classList.toggle("hidden", !canManage() || (isSupport() && !supportContext))
  );
  refs.ticketForm?.classList.toggle("hidden", isSupport());
  $$("[data-support-billing]").forEach((item) => item.classList.toggle("hidden", !isSupport()));
  $("#storeSelector").classList.toggle("hidden", isSupport() && !supportContext);
  $("#ownerCentralBtn")?.classList.toggle("hidden", !(isSupport() && supportContext));
  $("#newOrderBtn").disabled = !canWriteOrders();
  $("#newOrderBtnSecondary").disabled = !canWriteOrders();
  fillRoleOptions();
  renderBrand();
}

function renderBrand() {
  const store = activeStore();
  const assistance = activeAssistance();
  const supportContext = isSupportInTenantContext();
  const canOperateStore = Boolean(activeStoreId) && canWriteOrders();
  $("#storeSelector").classList.toggle("hidden", isSupport() && !supportContext);
  $("#ownerCentralBtn")?.classList.toggle("hidden", !(isSupport() && supportContext));
  $("#newOrderBtn").disabled = !canOperateStore;
  $("#newOrderBtnSecondary").disabled = !canOperateStore;
  if (isSupport() && !supportContext) {
    $("#brandTitle").textContent = "Anup OS";
    $("#brandSubtitle").textContent = "Dono do SaaS";
    $("#brandMark").textContent = "A";
    $("#sidebarStoreName").textContent = "Central Anup OS";
    $("#sidebarStoreText").textContent = "Gestão global do SaaS, faturamento, clientes e suporte.";
    $("#topbarEyebrow").textContent = "Dono Anup OS";
    $("#topbarTitle").textContent = "Gestão do SaaS";
    return;
  }
  if (isSupport() && supportContext && !store) {
    $("#brandTitle").textContent = assistance?.nome || "Assistência";
    $("#brandSubtitle").textContent = "Suporte Anup OS";
    $("#brandMark").textContent = (assistance?.nome || "A").slice(0, 1).toUpperCase();
    $("#sidebarStoreName").textContent = assistance?.nome || "Assistência selecionada";
    $("#sidebarStoreText").textContent = "Suporte completo na assistência selecionada.";
    $("#topbarEyebrow").textContent = "Suporte em assistência";
    $("#topbarTitle").textContent = assistance?.nome || "Assistência";
    return;
  }
  $("#brandTitle").textContent = store?.nome || "Anup OS";
  $("#brandSubtitle").textContent = profile?.nome || "Ordens de Serviço";
  $("#brandMark").textContent = (store?.nome || "Anup OS").slice(0, 1).toUpperCase();
  $("#sidebarStoreName").textContent = store?.nome || "Nenhuma loja liberada";
  $("#sidebarStoreText").textContent = isSupport()
    ? `Suporte completo em ${assistance?.nome || store?.assistenciaNome || "assistência"}`
    : store?.assistenciaNome || "Selecione uma loja para operar.";
  $("#topbarEyebrow").textContent = isSupport() ? "Suporte em loja" : "Painel administrativo";
  $("#topbarTitle").textContent = store?.nome || "Ordens de Serviço";
}

function renderStoreSelector() {
  const supportOption = isSupport() ? `<option value="">Central do SaaS</option>` : "";
  const selectorStores =
    isSupport() && activeSupportAssistanceId
      ? stores.filter((store) => store.assistenciaId === activeSupportAssistanceId)
      : stores;
  refs.storeSelector.innerHTML =
    supportOption +
    (selectorStores.map((store) => `<option value="${store.id}">${escapeHtml(store.nome)}</option>`).join("") ||
      `<option value="">Sem loja</option>`);
  refs.storeSelector.value = activeStoreId;
  renderBrand();
  fillStoreFields();
  fillUserStores();
}

function enterSupportStore(storeId) {
  if (!isSupport()) return;
  const store = stores.find((item) => item.id === storeId);
  if (!store) return toast("Loja não encontrada para suporte.", "error");
  activeStoreId = store.id;
  activeSupportAssistanceId = store.assistenciaId || "";
  renderShell();
  renderStoreSelector();
  subscribeStoreData();
  showSection("dashboard");
}

function enterSupportAssistance(assistanceId) {
  if (!isSupport()) return;
  const tenantStores = stores.filter((store) => store.assistenciaId === assistanceId);
  activeSupportAssistanceId = assistanceId;
  activeStoreId = tenantStores[0]?.id || "";
  renderShell();
  renderStoreSelector();
  subscribeStoreData();
  showSection(activeStoreId ? "dashboard" : "admin");
}

function returnToSaasCentral() {
  if (!isSupport()) return;
  activeSupportAssistanceId = "";
  activeStoreId = "";
  renderShell();
  renderStoreSelector();
  subscribeStoreData();
  showSection("suporte");
}

function openTenantModal(existingAssistanceId = "") {
  fillTenantOptions();
  refs.tenantForm.reset();
  $("#tenantTrialDays").value = "30";
  $("#tenantDueDate").value = addDaysISO(30);
  $("#tenantBillingType").value = "UNDEFINED";
  $("#tenantExisting").value = existingAssistanceId;
  $("#tenantExisting").dispatchEvent(new Event("change"));
  refs.tenantModal.showModal();
}

function fillStoreFields() {
  const store = activeStore();
  $("#storeNameInput").value = store?.nome || "";
  $("#storeLogoInput").value = store?.logoUrl || "";
  $("#storeAddressInput").value = store?.endereco || "";
  $("#storeCnpjInput").value = store?.cnpj || "";
  $("#storeInstagramInput").value = store?.instagram || "";
  $("#storeEmailInput").value = store?.email || "";
  $("#storeSiteInput").value = store?.site || "";
  $("#storeCepInput").value = store?.cep || "";
  $("#storeCityInput").value = store?.cidade || "";
  $("#storeStateInput").value = store?.estado || "";
  $("#storeWhatsappInput").value = maskPhone(store?.whatsapp || "");
  $("#storeWarrantyInput").value = store?.garantiaDias || 90;
  $("#storeMonthlyPriceInput").value = store?.valorMensal ? currency(store.valorMensal) : "";
  $("#storePlanTypeInput").value = store?.tipoPlano || "mensal";
  $("#storeClientTypeInput").value = store?.tipoCliente || "b2b";
  $("#storeOneShotValueInput").value = store?.valorPagamentoUnico ? currency(store.valorPagamentoUnico) : "";
  $("#storeSaasCostInput").value = store?.custoSaasMensal ? currency(store.custoSaasMensal) : "";
  $("#storeSaasInvestmentInput").value = store?.investimentoAquisicao ? currency(store.investimentoAquisicao) : "";
  $("#storeCustomerStatusInput").value = store?.statusCliente || "ativo";
  $("#storeAsaasBillingTypeInput").value = store?.asaasBillingType || "UNDEFINED";
  $("#storeTrialDaysInput").value = Number(store?.trialDias ?? 30);
  $("#storePaymentMethodInput").value = store?.formaPagamento || "";
  $("#storeDueDateInput").value = store?.planoVencimento || "";
  $("#storePlanStatusInput").value = store?.planoStatus || "em_dia";
  $("#storeAsaasStatusText").textContent = store?.asaasStatus
    ? `${store.asaasStatus} · ${billingTypeLabel(store.asaasBillingType)}`
    : "Não gerado";
  const invoiceLink = $("#storeAsaasInvoiceLink");
  invoiceLink.classList.toggle("hidden", !store?.asaasInvoiceUrl);
  if (store?.asaasInvoiceUrl) invoiceLink.href = store.asaasInvoiceUrl;
}

function fillUserStores(selected = []) {
  const availableStores =
    isSupport() && activeSupportAssistanceId
      ? stores.filter((store) => store.assistenciaId === activeSupportAssistanceId)
      : stores;
  $("#userStores").innerHTML = availableStores
    .map((store) => `<option value="${store.id}" ${selected.includes(store.id) ? "selected" : ""}>${escapeHtml(store.nome)}</option>`)
    .join("");
}

function fillTenantOptions() {
  $("#tenantExisting").innerHTML =
    `<option value="">Criar nova assistência</option>` +
    tenants.map((tenant) => `<option value="${tenant.id}">${escapeHtml(tenant.nome)}</option>`).join("");
  if (refs.noticeTenant) {
    refs.noticeTenant.innerHTML =
      `<option value="">Selecione uma assistência</option>` +
      tenants.map((tenant) => `<option value="${tenant.id}">${escapeHtml(tenant.nome)}</option>`).join("");
  }
}

function subscribeStoreData() {
  cleanupSubscriptions();
  orders = [];
  clients = [];
  users = [];
  renderDashboard();
  renderOrders();
  renderClients();
  if (isSupport()) subscribeSupport();
  subscribeNotices();
  subscribeTickets();
  if (!activeStoreId) return;

  refs.loadingState.classList.remove("hidden");
  const ordersRef = collection(db, ...storePath("ordens"));
  const clientsRef = collection(db, ...storePath("clientes"));

  unsubscribers.push(
    onSnapshot(
      query(ordersRef, orderBy("criadoEm", "desc")),
      (snapshot) => {
        orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        renderDashboard();
        renderOrders();
      },
      () => {
        refs.loadingState.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Não foi possível carregar as ordens desta loja.`;
      }
    )
  );

  unsubscribers.push(
    onSnapshot(query(clientsRef, orderBy("criadoEm", "desc")), (snapshot) => {
      clients = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderClients();
    })
  );

  if (canManage()) subscribeUsers();
}

function subscribeUsers() {
  const q = isSupport()
    ? query(collection(db, "usuarios"), orderBy("email"))
    : query(collection(db, "usuarios"), where("assistenciaId", "==", profile.assistenciaId));
  unsubscribers.push(
    onSnapshot(q, (snapshot) => {
      users = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderUsers();
    })
  );
}

function subscribeSupport() {
  unsubscribers.push(
    onSnapshot(query(collection(db, "lojas"), orderBy("nome")), (snapshot) => {
      stores = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderStoreSelector();
      renderSupport();
      renderSaasTenants();
    })
  );
  unsubscribers.push(
    onSnapshot(query(collection(db, "assistencias"), orderBy("nome")), (snapshot) => {
      tenants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      fillTenantOptions();
      renderSupport();
      renderSaasTenants();
    })
  );
}

function openOrderModal(order = null) {
  if (!canWriteOrders()) {
    toast("Seu nível permite apenas consulta.", "error");
    return;
  }
  if (!activeStoreId) {
    toast("Entre em uma loja antes de criar uma OS.", "error");
    return;
  }
  const store = activeStore();
  refs.orderForm.reset();
  $("#dataEntrada").value = todayISO();
  $("#garantiaDias").value = store?.garantiaDias || 90;
  $("#status").value = "Aguardando análise";
  $("#orderId").value = "";
  $("#orderModalTitle").textContent = "Nova OS";
  currentStatusBeforeEdit = "";

  if (order) {
    $("#orderModalTitle").textContent = `Editar ${order.numeroOS}`;
    $("#orderId").value = order.id;
    currentStatusBeforeEdit = order.status;
    setFormValue(order);
  }
  refs.orderModal.showModal();
}

function setFormValue(order) {
  const values = {
    clienteNome: order.clienteNome,
    clienteWhatsapp: maskPhone(order.clienteWhatsapp),
    clienteCpf: order.clienteCpf,
    clienteEndereco: order.clienteEndereco,
    clienteObservacoes: order.clienteObservacoes,
    marca: order.marca,
    modelo: order.modelo,
    imei: order.imei,
    status: order.status,
    defeitoRelatado: order.defeitoRelatado,
    diagnosticoTecnico: order.diagnosticoTecnico,
    servico: order.servico,
    pecas: order.pecas,
    valorMaoObra: currency(order.valorMaoObra),
    valorPecas: currency(order.valorPecas),
    valorTotal: currency(order.valorTotal),
    formaPagamento: order.formaPagamento,
    dataEntrada: order.dataEntrada || todayISO(),
    previsaoEntrega: order.previsaoEntrega,
    garantiaDias: order.garantiaDias || activeStore()?.garantiaDias || 90,
    custoPecas: currency(order.custoPecas),
    diagnosticoInterno: order.diagnosticoInterno,
    observacoesInternas: order.observacoesInternas,
  };
  Object.entries(values).forEach(([id, value]) => {
    $(`#${id}`).value = value || "";
  });
}

function formOrderPayload() {
  const valorMaoObra = parseCurrency($("#valorMaoObra").value);
  const valorPecas = parseCurrency($("#valorPecas").value);
  const custoPecas = parseCurrency($("#custoPecas").value);
  const valorTotal = valorMaoObra + valorPecas;
  const despesaPecas = valorPecas;
  const lucroBruto = valorMaoObra;
  const lucroReal = valorMaoObra;
  return {
    clienteNome: $("#clienteNome").value.trim(),
    clienteWhatsapp: $("#clienteWhatsapp").value.trim(),
    clienteCpf: $("#clienteCpf").value.trim(),
    clienteEndereco: $("#clienteEndereco").value.trim(),
    clienteObservacoes: $("#clienteObservacoes").value.trim(),
    marca: $("#marca").value.trim(),
    modelo: $("#modelo").value.trim(),
    imei: $("#imei").value.trim(),
    defeitoRelatado: $("#defeitoRelatado").value.trim(),
    diagnosticoTecnico: $("#diagnosticoTecnico").value.trim(),
    servico: $("#servico").value.trim(),
    pecas: $("#pecas").value.trim(),
    valorMaoObra,
    valorPecas,
    custoPecas,
    despesaPecas,
    valorTotal,
    lucroBruto,
    lucroReal,
    formaPagamento: $("#formaPagamento").value.trim(),
    status: $("#status").value,
    garantiaDias: Number($("#garantiaDias").value) || activeStore()?.garantiaDias || 90,
    dataEntrada: $("#dataEntrada").value || todayISO(),
    previsaoEntrega: $("#previsaoEntrega").value,
    diagnosticoInterno: $("#diagnosticoInterno").value.trim(),
    observacoesInternas: $("#observacoesInternas").value.trim(),
  };
}

function nextOrderNumber() {
  const year = new Date().getFullYear();
  const last = orders
    .map((order) => Number(String(order.numeroOS || "").split("-").pop()))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  return `OS-${year}-${String((last || 0) + 1).padStart(4, "0")}`;
}

async function upsertClient(payload) {
  const existing = clients.find(
    (client) =>
      normalizePhone(client.whatsapp) === normalizePhone(payload.clienteWhatsapp) ||
      client.nome.toLowerCase() === payload.clienteNome.toLowerCase()
  );
  const data = {
    nome: payload.clienteNome,
    whatsapp: payload.clienteWhatsapp,
    cpf: payload.clienteCpf,
    endereco: payload.clienteEndereco,
    observacoes: payload.clienteObservacoes,
    lojaId: activeStoreId,
    assistenciaId: activeStore()?.assistenciaId || null,
    atualizadoEm: serverTimestamp(),
  };
  if (existing) {
    await updateDoc(doc(db, ...storePath("clientes", existing.id)), data);
    return existing.id;
  }
  const created = await addDoc(collection(db, ...storePath("clientes")), {
    ...data,
    criadoEm: serverTimestamp(),
  });
  return created.id;
}

async function saveOrder(event) {
  event.preventDefault();
  if (!activeStoreId) return toast("Selecione uma loja antes de salvar.", "error");
  const id = $("#orderId").value;
  const payload = formOrderPayload();
  const clienteId = await upsertClient(payload);
  const store = activeStore();
  const orderPayload = {
    ...payload,
    clienteId,
    lojaId: activeStoreId,
    lojaNome: store?.nome || "",
    assistenciaId: store?.assistenciaId || null,
    atualizadoEm: serverTimestamp(),
  };

  if (id) {
    await updateDoc(doc(db, ...storePath("ordens", id)), orderPayload);
    await setDoc(doc(db, "public_ordens", id), publicPayload({ ...orderPayload, id, numeroOS: orders.find((order) => order.id === id)?.numeroOS }));
    toast("OS atualizada com sucesso.");
    const updated = { ...orders.find((order) => order.id === id), ...orderPayload, id };
    if (currentStatusBeforeEdit && currentStatusBeforeEdit !== payload.status) {
      window.open(whatsappLink(payload.clienteWhatsapp, statusMessage(updated, publicOrderUrl(id), store)), "_blank");
    }
  } else {
    const numeroOS = nextOrderNumber();
    const created = await addDoc(collection(db, ...storePath("ordens")), {
      ...orderPayload,
      numeroOS,
      criadoEm: serverTimestamp(),
    });
    await setDoc(doc(db, "public_ordens", created.id), publicPayload({ ...orderPayload, numeroOS }));
    toast("OS cadastrada com sucesso.");
    window.open(whatsappLink(payload.clienteWhatsapp, quoteMessage({ ...orderPayload, numeroOS }, publicOrderUrl(created.id), store)), "_blank");
  }
  refs.orderModal.close();
}

function publicPayload(order) {
  const store = activeStore();
  return {
    numeroOS: order.numeroOS,
    clienteNome: order.clienteNome,
    clienteWhatsapp: order.clienteWhatsapp,
    marca: order.marca,
    modelo: order.modelo,
    defeitoRelatado: order.defeitoRelatado,
    valorTotal: order.valorTotal,
    status: order.status,
    garantiaDias: order.garantiaDias,
    previsaoEntrega: order.previsaoEntrega,
    lojaId: activeStoreId,
    lojaNome: store?.nome || "",
    lojaLogo: store?.logoUrl || "",
    lojaCnpj: store?.cnpj || "",
    lojaEndereco: store?.endereco || "",
    lojaWhatsapp: store?.whatsapp || "",
    lojaInstagram: store?.instagram || "",
    lojaEmail: store?.email || "",
    lojaSite: store?.site || "",
    lojaCep: store?.cep || "",
    lojaCidade: store?.cidade || "",
    lojaEstado: store?.estado || "",
    atualizadoEm: serverTimestamp(),
  };
}

async function saveClient(event) {
  event.preventDefault();
  await addDoc(collection(db, ...storePath("clientes")), {
    nome: $("#clientNome").value.trim(),
    whatsapp: $("#clientWhatsapp").value.trim(),
    cpf: $("#clientCpf").value.trim(),
    endereco: $("#clientEndereco").value.trim(),
    observacoes: $("#clientObservacoes").value.trim(),
    lojaId: activeStoreId,
    assistenciaId: activeStore()?.assistenciaId || null,
    criadoEm: serverTimestamp(),
  });
  refs.clientForm.reset();
  refs.clientModal.close();
  toast("Cliente cadastrado com sucesso.");
}

function filteredOrders() {
  const term = refs.searchInput.value.toLowerCase().trim();
  const status = refs.statusFilter.value;
  const date = refs.dateFilter.value;
  return orders.filter((order) => {
    const haystack = [order.numeroOS, order.clienteNome, order.clienteWhatsapp, order.status, order.modelo, order.marca]
      .join(" ")
      .toLowerCase();
    return (!term || haystack.includes(term)) && (!status || order.status === status) && (!date || order.dataEntrada === date);
  });
}

function subscribeNotices() {
  const noticesQuery = query(collection(db, "avisos"), orderBy("criadoEm", "desc"));
  unsubscribers.push(
    onSnapshot(noticesQuery, (snapshot) => {
      const allNotices = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      notices = isSupport()
        ? allNotices
        : allNotices.filter(
            (notice) => notice.audience === "all" || notice.assistenciaId === profile?.assistenciaId
          );
      renderNotices();
    })
  );
}

function subscribeTickets() {
  const ticketsQuery = isSupport()
    ? query(collection(db, "chamados"), orderBy("criadoEm", "desc"))
    : query(collection(db, "chamados"), where("assistenciaId", "==", profile.assistenciaId), orderBy("criadoEm", "desc"));
  unsubscribers.push(
    onSnapshot(ticketsQuery, (snapshot) => {
      tickets = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderTickets();
    })
  );
}

function dashboardFilteredOrders() {
  const term = refs.dashboardSearchInput.value.toLowerCase().trim();
  const status = refs.dashboardStatusFilter.value;
  const date = refs.dashboardDateFilter.value;
  const period = refs.dashboardPeriodFilter.value;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentYear = String(now.getFullYear());

  return orders.filter((order) => {
    const haystack = [order.numeroOS, order.clienteNome, order.clienteWhatsapp, order.status, order.modelo, order.marca]
      .join(" ")
      .toLowerCase();
    const orderDate = order.dataEntrada || "";
    const matchesPeriod =
      !period ||
      (period === "today" && orderDate === todayISO()) ||
      (period === "month" && orderDate.startsWith(currentMonth)) ||
      (period === "year" && orderDate.startsWith(currentYear));

    return (
      (!term || haystack.includes(term)) &&
      (!status || order.status === status) &&
      (!date || orderDate === date) &&
      matchesPeriod
    );
  });
}

function renderDashboard() {
  const items = dashboardFilteredOrders();
  const billableItems = items.filter((order) => order.status !== "Cancelado");
  const open = items.filter((order) => ACTIVE_STATUSES.includes(order.status)).length;
  const progress = items.filter((order) => ["Aprovado", "Em conserto", "Aguardando peça"].includes(order.status)).length;
  const done = items.filter((order) => DONE_STATUSES.includes(order.status)).length;
  const approval = items.filter((order) => order.status === "Aguardando aprovação").length;
  const today = items.filter((order) => order.dataEntrada === todayISO()).length;
  const revenue = billableItems.reduce((sum, order) => sum + Number(order.valorTotal || 0), 0);
  const expenses = billableItems.reduce((sum, order) => sum + Number(order.valorPecas || 0), 0);
  const profit = billableItems.reduce((sum, order) => sum + Number(order.valorMaoObra || 0), 0);

  $("#metricOpen").textContent = open;
  $("#metricProgress").textContent = progress;
  $("#metricDone").textContent = done;
  $("#metricApproval").textContent = approval;
  $("#metricToday").textContent = today;
  $("#metricRevenue").textContent = currency(revenue);
  $("#metricExpenses").textContent = currency(expenses);
  $("#metricProfit").textContent = currency(profit);
  refs.recentOrders.innerHTML = items.slice(0, 6).map(renderRecentOrder).join("") || emptyMini("Nenhuma OS cadastrada.");
}

function renderRecentOrder(order) {
  return `<article class="recent-item">
    <div><strong>${escapeHtml(order.numeroOS)}</strong><p>${escapeHtml(order.clienteNome)} · ${escapeHtml(order.marca)} ${escapeHtml(order.modelo)}</p></div>
    <span class="status-badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
  </article>`;
}

function renderOrders() {
  const items = filteredOrders();
  refs.loadingState.classList.add("hidden");
  refs.emptyState.classList.toggle("hidden", items.length > 0);
  refs.ordersTable.innerHTML = items.map(renderOrderRow).join("");
}

function renderOrderRow(order) {
  return `<tr>
    <td><strong>${escapeHtml(order.numeroOS)}</strong></td>
    <td><div class="cell-title">${escapeHtml(order.clienteNome)}</div><div class="cell-sub">${escapeHtml(order.clienteWhatsapp)}</div></td>
    <td><div class="cell-title">${escapeHtml(order.marca)} ${escapeHtml(order.modelo)}</div><div class="cell-sub">${escapeHtml(order.defeitoRelatado)}</div></td>
    <td><span class="status-badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span></td>
    <td>${formatDate(order.dataEntrada)}</td>
    <td>${currency(order.valorTotal)}</td>
    <td><div class="action-row">
      <button class="icon-btn" title="Ver detalhes" data-action="details" data-id="${order.id}"><i class="fa-regular fa-eye"></i></button>
      <button class="icon-btn" title="Editar" data-action="edit" data-id="${order.id}"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-btn" title="WhatsApp" data-action="whatsapp" data-id="${order.id}"><i class="fa-brands fa-whatsapp"></i></button>
      <button class="icon-btn" title="Copiar link" data-action="copy" data-id="${order.id}"><i class="fa-regular fa-copy"></i></button>
      <button class="icon-btn" title="Imprimir" data-action="print" data-id="${order.id}"><i class="fa-solid fa-print"></i></button>
      <button class="icon-btn danger" title="Excluir" data-action="delete" data-id="${order.id}"><i class="fa-regular fa-trash-can"></i></button>
    </div></td>
  </tr>`;
}

function renderClients() {
  refs.clientsList.innerHTML =
    clients
      .map(
        (client) => `<article class="client-card">
          <div class="avatar">${escapeHtml(client.nome?.slice(0, 2).toUpperCase() || "CL")}</div>
          <div><h3>${escapeHtml(client.nome)}</h3><p><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(client.whatsapp)}</p><p>${escapeHtml(client.endereco || "Sem endereço")}</p></div>
        </article>`
      )
      .join("") || emptyMini("Nenhum cliente cadastrado.");
}

function renderUsers() {
  refs.usersList.innerHTML =
    users
      .filter((user) => isSupport() || user.assistenciaId === profile.assistenciaId)
      .map(
        (user) => `<article class="admin-card">
          <div><h3>${escapeHtml(user.nome || user.email)}</h3><p>${escapeHtml(user.email)}</p></div>
          <span class="status-badge status-slate">${escapeHtml(roleLabel(user.role))}</span>
          <button class="btn btn-ghost" data-user-action="edit" data-id="${user.id}"><i class="fa-solid fa-pen"></i>Editar</button>
        </article>`
      )
      .join("") || emptyMini("Nenhum usuário cadastrado.");
}

function paymentState(store) {
  if (store.statusCliente === "cancelado" || store.planoStatus === "cancelado") return "canceled";
  const due = new Date(`${store.planoVencimento || todayISO()}T00:00:00`);
  const days = Math.ceil((due - new Date()) / 86400000);
  if (store.planoStatus === "devendo" || days < 0) return "overdue";
  if (store.planoStatus === "perto_vencer") return "soon";
  if (days <= 5) return "soon";
  return "paid";
}

function paymentStateLabel(state) {
  const labels = {
    paid: "Em dia",
    soon: "Perto de vencer",
    overdue: "Devendo",
    canceled: "Cancelada",
  };
  return labels[state] || "Em dia";
}

function percent(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

function renderSupport() {
  if (!isSupport()) return;
  const term = refs.supportSearchInput?.value.toLowerCase().trim() || "";
  const paymentFilter = refs.supportPaymentFilter?.value || "";
  const activeStores = stores.filter((store) => store.statusCliente !== "cancelado" && store.planoStatus !== "cancelado");
  const canceledStores = stores.filter((store) => store.statusCliente === "cancelado" || store.planoStatus === "cancelado");
  const activeTenantIds = new Set(activeStores.map((store) => store.assistenciaId).filter(Boolean));
  const recurringStores = activeStores.filter((store) => (store.tipoPlano || "mensal") !== "unico");
  const oneShotStores = activeStores.filter((store) => (store.tipoPlano || "mensal") === "unico");
  const mrr = recurringStores.reduce((sum, store) => sum + Number(store.valorMensal || 0), 0);
  const arr = mrr * 12;
  const oneShotRevenue = oneShotStores.reduce(
    (sum, store) => sum + Number(store.valorPagamentoUnico || store.valorMensal || 0),
    0
  );
  const totalRevenue = mrr + oneShotRevenue;
  const operatingCost = activeStores.reduce((sum, store) => sum + Number(store.custoSaasMensal || 0), 0);
  const acquisitionInvestment = activeStores.reduce((sum, store) => sum + Number(store.investimentoAquisicao || 0), 0);
  const profit = totalRevenue - operatingCost;
  const margin = totalRevenue ? (profit / totalRevenue) * 100 : 0;
  const roi = acquisitionInvestment ? ((profit - acquisitionInvestment) / acquisitionInvestment) * 100 : profit > 0 ? 100 : 0;
  const churn = stores.length ? (canceledStores.length / stores.length) * 100 : 0;
  const b2b = activeStores.filter((store) => (store.tipoCliente || "b2b") === "b2b").length;
  const b2c = activeStores.filter((store) => (store.tipoCliente || "b2b") === "b2c").length;
  const overdue = activeStores.filter((store) => paymentState(store) === "overdue").length;
  const healthy = activeStores.length ? ((activeStores.length - overdue) / activeStores.length) * 100 : 0;
  const filteredStores = stores.filter((store) => {
    const tenant = tenants.find((item) => item.id === store.assistenciaId);
    const state = paymentState(store);
    const haystack = [
      store.nome,
      store.assistenciaNome,
      tenant?.nome,
      store.formaPagamento,
      store.planoStatus,
    ]
      .join(" ")
      .toLowerCase();
    return (!term || haystack.includes(term)) && (!paymentFilter || state === paymentFilter);
  });
  $("#metricActiveTenants").textContent = activeTenantIds.size || tenants.length;
  $("#metricActiveStores").textContent = activeStores.length;
  $("#metricMrr").textContent = currency(mrr);
  $("#metricArr").textContent = currency(arr);
  $("#metricOneShotRevenue").textContent = currency(oneShotRevenue);
  $("#metricTotalSaasRevenue").textContent = currency(totalRevenue);
  $("#metricSaasProfit").textContent = currency(profit);
  $("#metricOverdue").textContent = overdue;
  $("#metricChurn").textContent = percent(churn);
  $("#metricSaasMargin").textContent = percent(margin);
  $("#metricSaasRoi").textContent = percent(roi);
  $("#metricKpiHealth").textContent = percent(healthy);
  $("#metricB2B").textContent = b2b;
  $("#metricB2C").textContent = b2c;
  refs.supportListCount.textContent = `${filteredStores.length} ${filteredStores.length === 1 ? "loja" : "lojas"}`;

  const storesByTenant = filteredStores.reduce((groups, store) => {
    const key = store.assistenciaId || "sem_assistencia";
    if (!groups[key]) groups[key] = [];
    groups[key].push(store);
    return groups;
  }, {});

  refs.supportList.innerHTML =
    Object.entries(storesByTenant)
      .map(([tenantId, tenantStores]) => {
        const tenant = tenants.find((item) => item.id === tenantId);
        const tenantName = tenant?.nome || tenantStores[0]?.assistenciaNome || "Assistência sem cadastro";
        const totalMonthly = tenantStores
          .filter((store) => (store.tipoPlano || "mensal") !== "unico")
          .reduce((sum, store) => sum + Number(store.valorMensal || 0), 0);
        const totalOneShot = tenantStores
          .filter((store) => (store.tipoPlano || "mensal") === "unico")
          .reduce((sum, store) => sum + Number(store.valorPagamentoUnico || store.valorMensal || 0), 0);
        const overdueCount = tenantStores.filter((store) => paymentState(store) === "overdue").length;
        return `<article class="support-tenant">
          <div class="support-tenant-head">
            <div>
              <h3>${escapeHtml(tenantName)}</h3>
              <p>${tenantStores.length} ${tenantStores.length === 1 ? "loja" : "lojas"} · MRR ${currency(totalMonthly)} · Único ${currency(totalOneShot)} · ${overdueCount} devendo</p>
            </div>
            ${
              tenantId !== "sem_assistencia"
                ? `<button class="btn btn-ghost" data-saas-action="enter-tenant" data-id="${tenantId}">
              <i class="fa-solid fa-building-user"></i>
              Entrar na assistência
            </button>`
                : ""
            }
          </div>
          <div class="support-store-list">
            ${tenantStores.map(renderSupportStore).join("")}
          </div>
        </article>`;
      })
      .join("") || emptyMini("Nenhuma loja encontrada.");
}

function renderSupportStore(store) {
  const state = paymentState(store);
  const planType = store.tipoPlano || "mensal";
  const planLabel = { mensal: "Mensalista", anual: "Anual", unico: "Pagamento único" }[planType] || "Mensalista";
  const revenue = planType === "unico" ? Number(store.valorPagamentoUnico || store.valorMensal || 0) : Number(store.valorMensal || 0);
  return `<div class="support-card ${state}">
    <div>
      <h3>${escapeHtml(store.nome)}</h3>
      <p><span class="support-status-dot ${state}"></span>${paymentStateLabel(state)} · vence ${formatDate(store.planoVencimento)}</p>
      <p>${planLabel} · ${(store.tipoCliente || "b2b").toUpperCase()} · ${escapeHtml(store.formaPagamento || "Pagamento não informado")} · ${currency(revenue)}</p>
    </div>
    <div class="support-actions">
      ${
        store.asaasInvoiceUrl
          ? `<a class="btn btn-ghost" href="${escapeHtml(store.asaasInvoiceUrl)}" target="_blank" rel="noopener">
              <i class="fa-solid fa-file-invoice-dollar"></i>
              Cobrança
            </a>`
          : ""
      }
      <button class="btn btn-primary" data-support-action="enter-store" data-id="${store.id}">
        <i class="fa-solid fa-right-to-bracket"></i>
        Entrar na loja
      </button>
    </div>
  </div>`;
}

function renderSaasTenants() {
  if (!refs.saasTenantsList) return;
  refs.saasTenantsList.innerHTML =
    tenants
      .map((tenant) => {
        const tenantStores = stores.filter((store) => store.assistenciaId === tenant.id);
        const mrr = tenantStores
          .filter((store) => (store.tipoPlano || "mensal") !== "unico" && store.statusCliente !== "cancelado")
          .reduce((sum, store) => sum + Number(store.valorMensal || 0), 0);
        return `<article class="support-tenant">
          <div class="support-tenant-head">
            <div>
              <h3>${escapeHtml(tenant.nome)}</h3>
              <p>${tenantStores.length} lojas · MRR ${currency(mrr)}</p>
            </div>
            <div class="support-actions">
              <button class="btn btn-primary" data-saas-action="enter-tenant" data-id="${tenant.id}">
                <i class="fa-solid fa-building-user"></i>
                Entrar na assistência
              </button>
              <button class="btn btn-ghost" data-saas-action="new-store" data-id="${tenant.id}">
                <i class="fa-solid fa-plus"></i>
                Adicionar loja
              </button>
            </div>
          </div>
        </article>`;
      })
      .join("") || emptyMini("Nenhuma assistência cadastrada.");
}

function renderNotices() {
  if (!refs.noticeList) return;
  refs.noticeList.innerHTML =
    notices
      .map((notice) => {
        const tenant = tenants.find((item) => item.id === notice.assistenciaId);
        return `<article class="notice-card ${notice.priority || "info"}">
          <div>
            <span>${escapeHtml(notice.priority || "info")}</span>
            <h3>${escapeHtml(notice.title)}</h3>
            <p>${escapeHtml(notice.message)}</p>
            <small>${notice.audience === "all" ? "Todas as assistências" : escapeHtml(tenant?.nome || "Assistência específica")}</small>
          </div>
        </article>`;
      })
      .join("") || emptyMini("Nenhum aviso ativo.");
}

function renderTickets() {
  if (!refs.ticketList) return;
  refs.ticketList.innerHTML =
    tickets
      .map((ticket) => {
        const status = ticket.status || "aberto";
        return `<article class="ticket-card ${status}">
          <div>
            <div class="ticket-headline">
              <h3>${escapeHtml(ticket.subject)}</h3>
              <span class="status-badge status-slate">${escapeHtml(status)}</span>
            </div>
            <p>${escapeHtml(ticket.message)}</p>
            <small>${escapeHtml(ticket.assistenciaNome || "Assistência")} · ${escapeHtml(ticket.category || "suporte")} · ${escapeHtml(ticket.priority || "normal")}</small>
            ${ticket.response ? `<div class="ticket-response"><strong>Resposta Anup:</strong> ${escapeHtml(ticket.response)}</div>` : ""}
          </div>
          ${
            isSupport()
              ? `<div class="ticket-actions">
                  <button class="btn btn-ghost" data-ticket-action="respond" data-id="${ticket.id}"><i class="fa-solid fa-reply"></i>Responder</button>
                  <button class="btn btn-primary" data-ticket-action="close" data-id="${ticket.id}"><i class="fa-solid fa-check"></i>Fechar</button>
                </div>`
              : ""
          }
        </article>`;
      })
      .join("") || emptyMini("Nenhum chamado encontrado.");
}

function emptyMini(text) {
  return `<div class="mini-empty">${escapeHtml(text)}</div>`;
}

function openDetails(order) {
  $("#detailsTitle").textContent = `${order.numeroOS} · ${order.clienteNome}`;
  const profit = Number(order.valorMaoObra || 0);
  $("#detailsContent").innerHTML = `<div class="details-grid">
    ${detail("Cliente", order.clienteNome)}
    ${detail("WhatsApp", order.clienteWhatsapp)}
    ${detail("Aparelho", `${order.marca || ""} ${order.modelo || ""}`)}
    ${detail("IMEI", order.imei || "Não informado")}
    ${detail("Status", `<span class="status-badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span>`, true)}
    ${detail("Total", currency(order.valorTotal))}
    ${detail("Defeito relatado", order.defeitoRelatado, false, "span-2")}
    ${detail("Diagnóstico técnico", order.diagnosticoTecnico || "Não informado", false, "span-2")}
    ${detail("Serviço", order.servico || "Não informado", false, "span-2")}
    ${detail("Peças", order.pecas || "Não informado", false, "span-2")}
    ${detail("Despesa em peças", currency(order.valorPecas))}
    ${detail("Lucro mão de obra", currency(profit))}
    ${detail("Diagnóstico interno", order.diagnosticoInterno || "Não informado", false, "span-2 internal")}
    ${detail("Observações internas", order.observacoesInternas || "Não informado", false, "span-2 internal")}
  </div>
  <div class="status-update-box">
    <label class="field"><span>Atualizar status</span><select id="detailStatusSelect">${STATUSES.map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
    <button class="btn btn-ghost" data-detail-action="update-status"><i class="fa-solid fa-arrows-rotate"></i> Atualizar status</button>
    <button class="btn btn-primary" data-detail-action="notify"><i class="fa-brands fa-whatsapp"></i> Notificar cliente</button>
  </div>
  <div class="modal-footer">
    <button class="btn btn-ghost" data-detail-action="copy"><i class="fa-regular fa-copy"></i> Copiar link público</button>
    <button class="btn btn-ghost" data-detail-action="print"><i class="fa-solid fa-print"></i> Imprimir</button>
    <button class="btn btn-primary" data-detail-action="whatsapp"><i class="fa-brands fa-whatsapp"></i> Enviar orçamento</button>
  </div>`;
  $("#detailsContent").onclick = (event) => {
    const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
    if (action) handleOrderAction(action, order.id);
  };
  refs.detailsModal.showModal();
}

function detail(label, value, html = false, extra = "") {
  return `<div class="detail ${extra}"><span>${escapeHtml(label)}</span><strong>${html ? value : escapeHtml(value)}</strong></div>`;
}

async function handleOrderAction(action, id) {
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  const store = activeStore();
  const url = publicOrderUrl(id);
  if (action === "edit") openOrderModal(order);
  if (action === "details") openDetails(order);
  if (action === "whatsapp") window.open(whatsappLink(order.clienteWhatsapp, quoteMessage(order, url, store)), "_blank");
  if (action === "notify") window.open(whatsappLink(order.clienteWhatsapp, statusMessage(order, url, store)), "_blank");
  if (action === "update-status") {
    const status = $("#detailStatusSelect")?.value;
    if (!status || status === order.status) return toast("Escolha um novo status para atualizar.");
    const updatedOrder = { ...order, status };
    await updateDoc(doc(db, ...storePath("ordens", id)), { status, atualizadoEm: serverTimestamp() });
    await setDoc(doc(db, "public_ordens", id), publicPayload(updatedOrder));
    toast("Status atualizado com sucesso.");
    window.open(whatsappLink(order.clienteWhatsapp, statusMessage(updatedOrder, url, store)), "_blank");
    refs.detailsModal.close();
  }
  if (action === "copy") {
    await navigator.clipboard.writeText(url);
    toast("Link público copiado.");
  }
  if (action === "print") printCustomerOrder(order);
  if (action === "delete" && canWriteOrders()) {
    if (confirm(`Excluir a ${order.numeroOS}? Essa ação não pode ser desfeita.`)) {
      await deleteDoc(doc(db, ...storePath("ordens", id)));
      await deleteDoc(doc(db, "public_ordens", id));
      toast("OS excluída com sucesso.");
    }
  }
}

function printCustomerOrder(order) {
  const store = activeStore();
  const win = window.open("", "_blank");
  const url = publicOrderUrl(order.id);
  const locationLine = [store?.cidade, store?.estado].filter(Boolean).join(" - ");
  const cepLine = store?.cep ? `CEP ${store.cep}` : "";
  const logo = store?.logoUrl
    ? `<img class="logo" src="${escapeHtml(store.logoUrl)}" alt="Logo ${escapeHtml(store?.nome || "loja")}">`
    : `<div class="logo-fallback">${escapeHtml((store?.nome || "A").slice(0, 1).toUpperCase())}</div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.numeroOS)}</title>
  <style>
    @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}html,body{width:80mm;min-height:100%;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111827;background:#f8fafc;font-size:11px;line-height:1.28}.print{width:72mm;max-width:72mm;margin:8mm auto;background:white;padding:4mm;border:1px solid #dbe3ef}.head{border-bottom:1px dashed #111827;padding-bottom:3mm}.store-head{display:flex;gap:3mm;align-items:flex-start}.logo{width:15mm;height:15mm;object-fit:contain;border:1px solid #dbe3ef;border-radius:2mm}.logo-fallback{display:grid;width:15mm;height:15mm;place-items:center;border-radius:2mm;background:#111827;color:white;font-size:18px;font-weight:900}.brand{font-size:16px;font-weight:900;line-height:1.1;overflow-wrap:anywhere}.muted,.contact{color:#334155}.contact{margin:1mm 0 0;font-size:10px;line-height:1.25;overflow-wrap:anywhere}.os-box{margin-top:3mm;text-align:left}.os-number{font-size:18px;font-weight:900}.section-title{margin:4mm 0 2mm;font-size:10px;font-weight:900;text-transform:uppercase;color:#111827;letter-spacing:0;border-bottom:1px dashed #cbd5e1;padding-bottom:1mm}.grid{display:grid;grid-template-columns:1fr;gap:2mm}.box{border:1px solid #dbe3ef;border-radius:2mm;padding:2mm;background:#f8fafc;break-inside:avoid}.box span{display:block;color:#475569;font-size:9px;font-weight:900;text-transform:uppercase}.box strong{display:block;margin-top:1mm;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}.total-box{margin:4mm 0;padding:3mm;border:1px solid #111827;border-radius:2mm;text-align:right;break-inside:avoid}.total-box span{display:block;color:#111827;font-size:10px;font-weight:900;text-transform:uppercase}.total-box strong{display:block;margin-top:1mm;font-size:20px}.terms{font-size:10px;line-height:1.35;border-top:1px dashed #cbd5e1;padding-top:3mm;overflow-wrap:anywhere}.public-link{margin-top:2mm;color:#334155;font-size:9px;overflow-wrap:anywhere}.actions{margin-top:4mm;text-align:right}.actions button{padding:10px 16px;border:0;border-radius:8px;background:#0f766e;color:white;font-weight:800;cursor:pointer}@media print{html,body{width:72mm;background:white}.print{width:72mm;max-width:72mm;margin:0;padding:0;border:0}.actions{display:none}}
  </style></head><body><div class="print">
    <div class="head">
      <div class="store-head">
        ${logo}
        <div>
          <div class="brand">${escapeHtml(store?.nome || "Anup OS")}</div>
          ${customerPrintContact("CNPJ", store?.cnpj)}
          ${customerPrintContact("", store?.endereco)}
          ${customerPrintContact("", [locationLine, cepLine].filter(Boolean).join(" - "))}
          ${customerPrintContact("WhatsApp", store?.whatsapp)}
          ${customerPrintContact("Instagram", store?.instagram)}
          ${customerPrintContact("E-mail", store?.email)}
          ${customerPrintContact("Site", store?.site)}
        </div>
      </div>
      <div class="os-box">
        <div class="muted">Ordem de Serviço</div>
        <div class="os-number">${escapeHtml(order.numeroOS)}</div>
        <div class="muted">Entrada: ${formatDate(order.dataEntrada)}</div>
      </div>
    </div>
    <div class="section-title">Dados do atendimento</div>
    <div class="grid">
      ${customerPrintBox("Cliente", order.clienteNome)}
      ${customerPrintBox("WhatsApp do cliente", order.clienteWhatsapp)}
      ${customerPrintBox("Aparelho", `${order.marca || ""} ${order.modelo || ""}`.trim())}
      ${customerPrintBox("IMEI", order.imei || "Não informado")}
      ${customerPrintBox("Previsão de entrega", formatDate(order.previsaoEntrega))}
      ${customerPrintBox("Status", order.status)}
      ${customerPrintBox("Defeito relatado", order.defeitoRelatado, "wide")}
      ${customerPrintBox("Serviço a realizar/executado", order.servico || "A definir", "wide")}
      ${customerPrintBox("Peças utilizadas", order.pecas || "Não informado", "wide")}
      ${customerPrintBox("Garantia", `${order.garantiaDias || 90} dias`)}
      ${customerPrintBox("Forma de pagamento", order.formaPagamento || "A combinar")}
    </div>
    <div class="total-box"><span>Valor total</span><strong>${currency(order.valorTotal)}</strong></div>
    <div class="terms">
      <strong>Garantia:</strong> ${order.garantiaDias || 90} dias sobre o serviço executado, sem cobertura para mau uso, dano físico, líquido ou violação por terceiros.
      <div class="public-link"><strong>Acompanhamento online:</strong> ${escapeHtml(url)}</div>
    </div>
    <div class="actions"><button onclick="window.print()">Imprimir</button></div>
  </div></body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function customerPrintContact(label, value) {
  if (!value) return "";
  const prefix = label ? `${label}: ` : "";
  return `<p class="contact">${escapeHtml(prefix)}${escapeHtml(value)}</p>`;
}

function customerPrintBox(label, value, extra = "") {
  return `<div class="box ${extra}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Não informado")}</strong></div>`;
}

function printOrder(order) {
  return printCustomerOrder(order);
}

async function saveStore(event) {
  event.preventDefault();
  if (!canManage() || !activeStoreId) return;
  const payload = storePayloadFromForm();
  await updateDoc(doc(db, "lojas", activeStoreId), payload);
  stores = stores.map((store) => (store.id === activeStoreId ? { ...store, ...payload } : store));
  renderStoreSelector();
  toast("Dados da loja atualizados.");
}

function storePayloadFromForm() {
  const payload = {
    nome: $("#storeNameInput").value.trim(),
    logoUrl: $("#storeLogoInput").value.trim(),
    endereco: $("#storeAddressInput").value.trim(),
    cnpj: $("#storeCnpjInput").value.trim(),
    instagram: $("#storeInstagramInput").value.trim(),
    email: $("#storeEmailInput").value.trim(),
    site: $("#storeSiteInput").value.trim(),
    cep: $("#storeCepInput").value.trim(),
    cidade: $("#storeCityInput").value.trim(),
    estado: $("#storeStateInput").value.trim().toUpperCase(),
    whatsapp: normalizePhone($("#storeWhatsappInput").value),
    garantiaDias: Number($("#storeWarrantyInput").value) || 90,
    atualizadoEm: serverTimestamp(),
  };
  if (isSupport()) {
    payload.valorMensal = parseCurrency($("#storeMonthlyPriceInput").value);
    payload.tipoPlano = $("#storePlanTypeInput").value;
    payload.tipoCliente = $("#storeClientTypeInput").value;
    payload.valorPagamentoUnico = parseCurrency($("#storeOneShotValueInput").value);
    payload.custoSaasMensal = parseCurrency($("#storeSaasCostInput").value);
    payload.investimentoAquisicao = parseCurrency($("#storeSaasInvestmentInput").value);
    payload.statusCliente = $("#storeCustomerStatusInput").value;
    payload.asaasBillingType = $("#storeAsaasBillingTypeInput").value;
    payload.trialDias = Number($("#storeTrialDaysInput").value) || 0;
    payload.formaPagamento = $("#storePaymentMethodInput").value.trim() || billingTypeLabel(payload.asaasBillingType);
    payload.planoVencimento = $("#storeDueDateInput").value;
    payload.planoStatus = $("#storePlanStatusInput").value;
  }
  return payload;
}

function openUserModal(user = null) {
  refs.userForm.reset();
  $("#userId").value = user?.id || "";
  $("#userModalTitle").textContent = user ? "Editar usuário" : "Novo usuário";
  $("#userPasswordField").classList.toggle("hidden", Boolean(user));
  $("#resetPasswordBtn").classList.toggle("hidden", !user);
  $("#userName").value = user?.nome || "";
  $("#userEmail").value = user?.email || "";
  $("#userEmail").disabled = Boolean(user);
  $("#userRole").value = user?.role || "tecnico";
  fillUserStores(user?.lojaIds || [activeStoreId].filter(Boolean));
  refs.userModal.showModal();
}

async function saveUser(event) {
  event.preventDefault();
  if (!canManage()) return;
  const id = $("#userId").value;
  const selectedStores = [...$("#userStores").selectedOptions].map((item) => item.value);
  const payload = {
    nome: $("#userName").value.trim(),
    email: $("#userEmail").value.trim().toLowerCase(),
    role: $("#userRole").value,
    assistenciaId: isSupport() ? activeSupportAssistanceId || activeStore()?.assistenciaId || null : profile.assistenciaId,
    lojaIds: selectedStores,
    ativo: true,
    atualizadoEm: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "usuarios", id), payload);
  } else {
    const password = $("#userPassword").value;
    if (!password || password.length < 6) return toast("Informe uma senha inicial com pelo menos 6 caracteres.", "error");
    const credential = await createUserWithEmailAndPassword(secondaryAuth, payload.email, password);
    await setDoc(doc(db, "usuarios", credential.user.uid), { ...payload, criadoEm: serverTimestamp() });
    await signOut(secondaryAuth);
  }
  refs.userModal.close();
  toast("Usuário salvo com sucesso.");
}

async function resetUserPassword() {
  const email = $("#userEmail").value;
  if (!email) return;
  await sendPasswordResetEmail(auth, email);
  toast("E-mail de redefinição de senha enviado.");
}

async function generateAsaasBillingForStore(storeId, options = {}) {
  if (!isSupport() || !storeId) return;
  const button = $("#generateAsaasBillingBtn");
  if (button) button.disabled = true;
  try {
    const result = await createAsaasBilling({
      storeId,
      force: Boolean(options.force),
    });
    const data = result.data || {};
    stores = stores.map((store) =>
      store.id === storeId
        ? {
            ...store,
            asaasStatus: data.status,
            asaasCustomerId: data.customerId,
            asaasSubscriptionId: data.subscriptionId || store.asaasSubscriptionId || "",
            asaasPaymentId: data.paymentId || store.asaasPaymentId || "",
            asaasInvoiceUrl: data.invoiceUrl || store.asaasInvoiceUrl || "",
            trialAte: data.trialEndsAt || store.trialAte || "",
          }
        : store
    );
    renderStoreSelector();
    toast(data.message || "Cobrança Asaas gerada.");
    return data;
  } catch (error) {
    toast(error?.message || "Não foi possível gerar a cobrança Asaas.", "error");
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveTenant(event) {
  event.preventDefault();
  if (!isSupport()) return;
  let assistenciaId = $("#tenantExisting").value;
  let assistenciaNome = $("#tenantName").value.trim();
  const planType = $("#tenantPlanType").value;
  const monthlyValue = parseCurrency($("#tenantMonthlyPrice").value);
  const oneShotValue = parseCurrency($("#tenantOneShotValue").value);
  const billingValue = planValue(planType, monthlyValue, oneShotValue);
  const trialDays = Number($("#tenantTrialDays").value) || 0;
  if (billingValue <= 0) return toast("Informe o valor do plano para gerar a cobrança.", "error");
  if (assistenciaId) {
    assistenciaNome = tenants.find((tenant) => tenant.id === assistenciaId)?.nome || assistenciaNome;
  } else {
    if (!assistenciaNome) return toast("Informe o nome da nova assistência.", "error");
    const assistencia = await addDoc(collection(db, "assistencias"), {
      nome: assistenciaNome,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
    assistenciaId = assistencia.id;
  }
  const firstDueDate = trialDays > 0 ? addDaysISO(trialDays) : $("#tenantDueDate").value;
  const storeRef = await addDoc(collection(db, "lojas"), {
    nome: $("#tenantStoreName").value.trim(),
    assistenciaId,
    assistenciaNome,
    logoUrl: "",
    endereco: "",
    cnpj: $("#tenantBillingDocument").value.replace(/\D/g, ""),
    instagram: "",
    email: $("#tenantBillingEmail").value.trim().toLowerCase(),
    site: "",
    cep: "",
    cidade: "",
    estado: "",
    whatsapp: normalizePhone($("#tenantBillingPhone").value),
    valorMensal: monthlyValue,
    tipoPlano: planType,
    tipoCliente: $("#tenantClientType").value,
    valorPagamentoUnico: oneShotValue,
    valorPlanoAtual: billingValue,
    custoSaasMensal: 0,
    investimentoAquisicao: 0,
    statusCliente: trialDays > 0 ? "teste" : "ativo",
    formaPagamento: billingTypeLabel($("#tenantBillingType").value),
    asaasBillingType: $("#tenantBillingType").value,
    asaasStatus: "pendente",
    asaasCustomerId: "",
    asaasSubscriptionId: "",
    asaasPaymentId: "",
    asaasInvoiceUrl: "",
    trialDias: trialDays,
    trialAte: trialDays > 0 ? firstDueDate : "",
    planoVencimento: firstDueDate,
    planoStatus: "em_dia",
    garantiaDias: 90,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  const billing = await generateAsaasBillingForStore(storeRef.id);
  refs.tenantForm.reset();
  refs.tenantModal.close();
  $("#tenantTrialDays").value = "30";
  toast(
    billing
      ? "Assistência cadastrada e cobrança enviada para a Asaas."
      : "Assistência cadastrada. Revise os dados e gere a cobrança Asaas pela Administração."
  );
}

async function saveNotice(event) {
  event.preventDefault();
  if (!isSupport()) return;
  const audience = $("#noticeAudience").value;
  const assistenciaId = audience === "tenant" ? $("#noticeTenant").value : "";
  if (audience === "tenant" && !assistenciaId) {
    toast("Selecione a assistência que receberá o aviso.", "error");
    return;
  }
  await addDoc(collection(db, "avisos"), {
    title: $("#noticeTitle").value.trim(),
    message: $("#noticeMessage").value.trim(),
    priority: $("#noticePriority").value,
    audience,
    assistenciaId,
    ativo: true,
    criadoPor: currentUser.email,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  refs.noticeForm.reset();
  toast("Aviso publicado.");
}

async function saveTicket(event) {
  event.preventDefault();
  if (isSupport()) return;
  const store = activeStore();
  await addDoc(collection(db, "chamados"), {
    subject: $("#ticketSubject").value.trim(),
    message: $("#ticketMessage").value.trim(),
    category: $("#ticketCategory").value,
    priority: $("#ticketPriority").value,
    status: "aberto",
    assistenciaId: profile.assistenciaId,
    assistenciaNome: store?.assistenciaNome || "",
    lojaId: activeStoreId || "",
    lojaNome: store?.nome || "",
    abertoPor: currentUser.email,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  refs.ticketForm.reset();
  toast("Chamado aberto para o suporte Anup.");
}

async function handleTicketAction(action, id) {
  if (!isSupport()) return;
  if (action === "respond") {
    const response = prompt("Resposta para a assistência:");
    if (!response) return;
    await updateDoc(doc(db, "chamados", id), {
      response,
      status: "respondido",
      respondidoPor: currentUser.email,
      atualizadoEm: serverTimestamp(),
    });
    toast("Chamado respondido.");
  }
  if (action === "close") {
    await updateDoc(doc(db, "chamados", id), {
      status: "fechado",
      atualizadoEm: serverTimestamp(),
    });
    toast("Chamado fechado.");
  }
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", () => signOut(auth));
  $("#newOrderBtn").addEventListener("click", () => openOrderModal());
  $("#newOrderBtnSecondary").addEventListener("click", () => openOrderModal());
  $("#newClientBtn").addEventListener("click", () => refs.clientModal.showModal());
  $("#newUserBtn").addEventListener("click", () => openUserModal());
  $("#newTenantBtn").addEventListener("click", () => openTenantModal());
  $("#newTenantBtnSecondary").addEventListener("click", () => openTenantModal());
  $("#tenantExisting").addEventListener("change", () => {
    const hasExisting = Boolean($("#tenantExisting").value);
    $("#tenantName").disabled = hasExisting;
    $("#tenantName").required = !hasExisting;
    if (hasExisting) $("#tenantName").value = "";
  });
  $("#tenantTrialDays").addEventListener("input", () => {
    $("#tenantDueDate").value = addDaysISO(Number($("#tenantTrialDays").value) || 0);
  });
  $("#resetPasswordBtn").addEventListener("click", resetUserPassword);
  $("#refreshBtn").addEventListener("click", () => {
    renderDashboard();
    renderOrders();
    toast("Painel atualizado.");
  });
  $("#generateAsaasBillingBtn").addEventListener("click", async () => {
    if (!activeStoreId) return toast("Entre em uma loja antes de gerar a cobrança.", "error");
    const payload = storePayloadFromForm();
    await updateDoc(doc(db, "lojas", activeStoreId), payload);
    stores = stores.map((store) => (store.id === activeStoreId ? { ...store, ...payload } : store));
    await generateAsaasBillingForStore(activeStoreId);
  });
  $("#ownerCentralBtn").addEventListener("click", returnToSaasCentral);
  refs.storeSelector.addEventListener("change", () => {
    activeStoreId = refs.storeSelector.value;
    if (isSupport() && !activeStoreId) {
      returnToSaasCentral();
      return;
    }
    if (isSupport()) activeSupportAssistanceId = activeStore()?.assistenciaId || activeSupportAssistanceId;
    renderShell();
    renderBrand();
    fillStoreFields();
    subscribeStoreData();
  });
  refs.orderForm.addEventListener("submit", saveOrder);
  refs.clientForm.addEventListener("submit", saveClient);
  refs.userForm.addEventListener("submit", saveUser);
  refs.tenantForm.addEventListener("submit", saveTenant);
  refs.noticeForm.addEventListener("submit", saveNotice);
  refs.ticketForm.addEventListener("submit", saveTicket);
  refs.storeForm.addEventListener("submit", saveStore);
  [refs.searchInput, refs.statusFilter, refs.dateFilter].forEach((input) => input.addEventListener("input", renderOrders));
  [
    refs.dashboardSearchInput,
    refs.dashboardStatusFilter,
    refs.dashboardDateFilter,
    refs.dashboardPeriodFilter,
  ].forEach((input) => input.addEventListener("input", renderDashboard));
  [refs.supportSearchInput, refs.supportPaymentFilter].forEach((input) => input.addEventListener("input", renderSupport));
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  refs.ordersTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) handleOrderAction(button.dataset.action, button.dataset.id);
  });
  refs.usersList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-action='edit']");
    if (button) openUserModal(users.find((user) => user.id === button.dataset.id));
  });
  refs.supportList.addEventListener("click", (event) => {
    const storeButton = event.target.closest("[data-support-action='enter-store']");
    if (storeButton) {
      enterSupportStore(storeButton.dataset.id);
      return;
    }
    const tenantButton = event.target.closest("[data-saas-action='enter-tenant']");
    if (tenantButton) enterSupportAssistance(tenantButton.dataset.id);
  });
  refs.saasTenantsList.addEventListener("click", (event) => {
    const enterButton = event.target.closest("[data-saas-action='enter-tenant']");
    if (enterButton) {
      enterSupportAssistance(enterButton.dataset.id);
      return;
    }
    const button = event.target.closest("[data-saas-action='new-store']");
    if (!button) return;
    openTenantModal(button.dataset.id);
  });
  refs.ticketList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ticket-action]");
    if (button) handleTicketAction(button.dataset.ticketAction, button.dataset.id);
  });
}

onAuthStateChanged(auth, async (user) => {
  cleanupSubscriptions();
  currentUser = user;
  if (!user) {
    refs.authScreen.classList.remove("hidden");
    refs.appShell.classList.add("hidden");
    return;
  }
  try {
    profile = await loadProfile(user);
    if (!profile.ativo) throw new Error("Usuário inativo.");
    await loadStores();
    renderShell();
    subscribeStoreData();
    const initialSection = isSupport() ? "suporte" : location.hash?.replace("#", "") || "dashboard";
    showSection(initialSection);
  } catch (error) {
  console.error("ERRO REAL:", error);

  toast(error.message, "error");
}
});

fillStatusOptions();
bindNavigation();
bindMasks();
bindEvents();


