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

let orders = [];
let clients = [];
let users = [];
let stores = [];
let tenants = [];
let currentUser = null;
let profile = null;
let activeStoreId = "";
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
  storeForm: $("#storeForm"),
  ordersTable: $("#ordersTable"),
  recentOrders: $("#recentOrders"),
  clientsList: $("#clientsList"),
  usersList: $("#usersList"),
  supportList: $("#supportList"),
  loadingState: $("#loadingState"),
  emptyState: $("#emptyState"),
  searchInput: $("#searchInput"),
  statusFilter: $("#statusFilter"),
  dateFilter: $("#dateFilter"),
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

function canWriteOrders() {
  return isSupport() || !["financeiro", "leitura"].includes(profile?.role);
}

function activeStore() {
  return stores.find((store) => store.id === activeStoreId);
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
  if (target === "suporte" && !isSupport()) return;
  $$(".view-section").forEach((section) => section.classList.remove("is-visible"));
  $(`#${target}`)?.classList.add("is-visible");
  $$(".nav-link").forEach((nav) => nav.classList.toggle("active", nav.dataset.sectionLink === target));
  history.replaceState(null, "", `#${target}`);
}

function bindMasks() {
  ["#clienteWhatsapp", "#clientWhatsapp", "#storeWhatsappInput"].forEach((selector) => {
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
    $(selector).addEventListener("blur", updateTotal);
  });
}

function updateTotal() {
  const total = parseCurrency($("#valorMaoObra").value) + parseCurrency($("#valorPecas").value);
  if (total) $("#valorTotal").value = currency(total);
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
      nome: "Suporte Anup OS",
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
  } else {
    if (!profile?.lojaIds?.length) {
      stores = [];
      return;
    }
    const results = await Promise.all(profile.lojaIds.map((lojaId) => getDoc(doc(db, "lojas", lojaId))));
    stores = results.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
  }
  activeStoreId = stores[0]?.id || "";
  renderStoreSelector();
}

function renderShell() {
  refs.authScreen.classList.add("hidden");
  refs.appShell.classList.remove("hidden");
  $$("[data-permission='support']").forEach((item) => item.classList.toggle("hidden", !isSupport()));
  $$("[data-permission='manage']").forEach((item) => item.classList.toggle("hidden", !canManage()));
  $$("[data-support-billing]").forEach((item) => item.classList.toggle("hidden", !isSupport()));
  $("#newOrderBtn").disabled = !canWriteOrders();
  $("#newOrderBtnSecondary").disabled = !canWriteOrders();
  fillRoleOptions();
  renderBrand();
}

function renderBrand() {
  const store = activeStore();
  $("#brandTitle").textContent = store?.nome || "Anup OS";
  $("#brandSubtitle").textContent = profile?.nome || "Ordens de Serviço";
  $("#brandMark").textContent = (store?.nome || "Anup OS").slice(0, 1).toUpperCase();
  $("#sidebarStoreName").textContent = store?.nome || "Nenhuma loja liberada";
  $("#sidebarStoreText").textContent = store?.assistenciaNome || "Selecione uma loja para operar.";
}

function renderStoreSelector() {
  refs.storeSelector.innerHTML =
    stores.map((store) => `<option value="${store.id}">${escapeHtml(store.nome)}</option>`).join("") ||
    `<option value="">Sem loja</option>`;
  refs.storeSelector.value = activeStoreId;
  renderBrand();
  fillStoreFields();
  fillUserStores();
}

function fillStoreFields() {
  const store = activeStore();
  $("#storeNameInput").value = store?.nome || "";
  $("#storeLogoInput").value = store?.logoUrl || "";
  $("#storeAddressInput").value = store?.endereco || "";
  $("#storeWhatsappInput").value = maskPhone(store?.whatsapp || "");
  $("#storeWarrantyInput").value = store?.garantiaDias || 90;
  $("#storeMonthlyPriceInput").value = store?.valorMensal ? currency(store.valorMensal) : "";
  $("#storePaymentMethodInput").value = store?.formaPagamento || "";
  $("#storeDueDateInput").value = store?.planoVencimento || "";
  $("#storePlanStatusInput").value = store?.planoStatus || "em_dia";
}

function fillUserStores(selected = []) {
  $("#userStores").innerHTML = stores
    .map((store) => `<option value="${store.id}" ${selected.includes(store.id) ? "selected" : ""}>${escapeHtml(store.nome)}</option>`)
    .join("");
}

function fillTenantOptions() {
  $("#tenantExisting").innerHTML =
    `<option value="">Criar nova assistência</option>` +
    tenants.map((tenant) => `<option value="${tenant.id}">${escapeHtml(tenant.nome)}</option>`).join("");
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
      if (!activeStoreId && stores[0]) activeStoreId = stores[0].id;
      renderStoreSelector();
      renderSupport();
    })
  );
  unsubscribers.push(
    onSnapshot(query(collection(db, "assistencias"), orderBy("nome")), (snapshot) => {
      tenants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      fillTenantOptions();
      renderSupport();
    })
  );
}

function openOrderModal(order = null) {
  if (!canWriteOrders()) {
    toast("Seu nível permite apenas consulta.", "error");
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
  const valorTotal = parseCurrency($("#valorTotal").value) || valorMaoObra + valorPecas;
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
    valorTotal,
    formaPagamento: $("#formaPagamento").value.trim(),
    status: $("#status").value,
    garantiaDias: Number($("#garantiaDias").value) || activeStore()?.garantiaDias || 90,
    dataEntrada: $("#dataEntrada").value || todayISO(),
    previsaoEntrega: $("#previsaoEntrega").value,
    custoPecas: parseCurrency($("#custoPecas").value),
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
    lojaEndereco: store?.endereco || "",
    lojaWhatsapp: store?.whatsapp || "",
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

function renderDashboard() {
  const open = orders.filter((order) => ACTIVE_STATUSES.includes(order.status)).length;
  const progress = orders.filter((order) => ["Aprovado", "Em conserto", "Aguardando peça"].includes(order.status)).length;
  const done = orders.filter((order) => DONE_STATUSES.includes(order.status)).length;
  const approval = orders.filter((order) => order.status === "Aguardando aprovação").length;
  const today = orders.filter((order) => order.dataEntrada === todayISO()).length;
  const revenue = orders.filter((order) => order.status !== "Cancelado").reduce((sum, order) => sum + Number(order.valorTotal || 0), 0);

  $("#metricOpen").textContent = open;
  $("#metricProgress").textContent = progress;
  $("#metricDone").textContent = done;
  $("#metricApproval").textContent = approval;
  $("#metricToday").textContent = today;
  $("#metricRevenue").textContent = currency(revenue);
  refs.recentOrders.innerHTML = orders.slice(0, 6).map(renderRecentOrder).join("") || emptyMini("Nenhuma OS cadastrada.");
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
  const due = new Date(`${store.planoVencimento || todayISO()}T00:00:00`);
  const days = Math.ceil((due - new Date()) / 86400000);
  if (store.planoStatus === "devendo" || days < 0) return "overdue";
  if (store.planoStatus === "perto_vencer") return "soon";
  if (days <= 5) return "soon";
  return "paid";
}

function renderSupport() {
  if (!isSupport()) return;
  const paid = stores.filter((store) => paymentState(store) === "paid").length;
  const soon = stores.filter((store) => paymentState(store) === "soon").length;
  const overdue = stores.filter((store) => paymentState(store) === "overdue").length;
  $("#metricStores").textContent = stores.length;
  $("#metricPaid").textContent = paid;
  $("#metricDueSoon").textContent = soon;
  $("#metricOverdue").textContent = overdue;
  refs.supportList.innerHTML =
    stores
      .map((store) => {
        const state = paymentState(store);
        const tenant = tenants.find((item) => item.id === store.assistenciaId);
        return `<article class="support-card ${state}">
          <div>
            <h3>${escapeHtml(store.nome)}</h3>
            <p>${escapeHtml(tenant?.nome || store.assistenciaNome || "Assistência sem nome")}</p>
            <p>${escapeHtml(store.formaPagamento || "Pagamento não informado")} · ${currency(store.valorMensal || 0)} · vence ${formatDate(store.planoVencimento)}</p>
          </div>
          <button class="btn btn-primary" data-support-action="enter-store" data-id="${store.id}">
            <i class="fa-solid fa-right-to-bracket"></i>
            Entrar na loja
          </button>
        </article>`;
      })
      .join("") || emptyMini("Nenhuma loja cadastrada.");
}

function emptyMini(text) {
  return `<div class="mini-empty">${escapeHtml(text)}</div>`;
}

function openDetails(order) {
  $("#detailsTitle").textContent = `${order.numeroOS} · ${order.clienteNome}`;
  const profit = Number(order.valorTotal || 0) - Number(order.custoPecas || 0);
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
    ${detail("Custo de peças", currency(order.custoPecas))}
    ${detail("Lucro estimado", currency(profit))}
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
  if (action === "print") printOrder(order);
  if (action === "delete" && canWriteOrders()) {
    if (confirm(`Excluir a ${order.numeroOS}? Essa ação não pode ser desfeita.`)) {
      await deleteDoc(doc(db, ...storePath("ordens", id)));
      await deleteDoc(doc(db, "public_ordens", id));
      toast("OS excluída com sucesso.");
    }
  }
}

function printOrder(order) {
  const store = activeStore();
  const win = window.open("", "_blank");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${order.numeroOS}</title>
  <style>body{font-family:Arial,sans-serif;color:#111827;margin:32px}.print{max-width:820px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:18px}.brand{font-size:28px;font-weight:800}.muted{color:#64748b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.box{border:1px solid #cbd5e1;border-radius:8px;padding:14px}.box span{display:block;color:#64748b;font-size:12px;text-transform:uppercase}.box strong{display:block;margin-top:5px}.terms{font-size:13px;line-height:1.6;border-top:1px solid #cbd5e1;padding-top:16px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:60px}.line{border-top:1px solid #111827;text-align:center;padding-top:8px}.total{font-size:22px}@media print{button{display:none}body{margin:18px}}</style>
  </head><body><div class="print">
    <div class="head"><div><div class="brand">${escapeHtml(store?.nome || "Anup OS")}</div><p class="muted">${escapeHtml(store?.endereco || "")}</p></div><div><strong>${order.numeroOS}</strong><p class="muted">Entrada: ${formatDate(order.dataEntrada)}</p></div></div>
    <div class="grid">
      ${printBox("Cliente", order.clienteNome)}${printBox("WhatsApp", order.clienteWhatsapp)}${printBox("Aparelho", `${order.marca || ""} ${order.modelo || ""}`)}${printBox("IMEI", order.imei || "Não informado")}
      ${printBox("Defeito", order.defeitoRelatado)}${printBox("Serviço", order.servico || "A definir")}${printBox("Peças", order.pecas || "Não informado")}${printBox("Previsão", formatDate(order.previsaoEntrega))}
      ${printBox("Mão de obra", currency(order.valorMaoObra))}${printBox("Peças", currency(order.valorPecas))}${printBox("Forma de pagamento", order.formaPagamento || "A combinar")}${printBox("Total", `<span class="total">${currency(order.valorTotal)}</span>`, true)}
    </div>
    <div class="terms"><strong>Garantia:</strong> ${order.garantiaDias || 90} dias para o serviço executado, conforme condições da loja.</div>
    <div class="sign"><div class="line">Assinatura do cliente</div><div class="line">${escapeHtml(store?.nome || "Anup OS")}</div></div>
    <button onclick="window.print()">Imprimir</button>
  </div></body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function printBox(label, value, html = false) {
  return `<div class="box"><span>${escapeHtml(label)}</span><strong>${html ? value : escapeHtml(value)}</strong></div>`;
}

async function saveStore(event) {
  event.preventDefault();
  if (!canManage() || !activeStoreId) return;
  const payload = {
    nome: $("#storeNameInput").value.trim(),
    logoUrl: $("#storeLogoInput").value.trim(),
    endereco: $("#storeAddressInput").value.trim(),
    whatsapp: normalizePhone($("#storeWhatsappInput").value),
    garantiaDias: Number($("#storeWarrantyInput").value) || 90,
    atualizadoEm: serverTimestamp(),
  };
  if (isSupport()) {
    payload.valorMensal = parseCurrency($("#storeMonthlyPriceInput").value);
    payload.formaPagamento = $("#storePaymentMethodInput").value.trim();
    payload.planoVencimento = $("#storeDueDateInput").value;
    payload.planoStatus = $("#storePlanStatusInput").value;
  }
  await updateDoc(doc(db, "lojas", activeStoreId), payload);
  stores = stores.map((store) => (store.id === activeStoreId ? { ...store, ...payload } : store));
  renderStoreSelector();
  toast("Dados da loja atualizados.");
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
    assistenciaId: isSupport() ? activeStore()?.assistenciaId || null : profile.assistenciaId,
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

async function saveTenant(event) {
  event.preventDefault();
  if (!isSupport()) return;
  let assistenciaId = $("#tenantExisting").value;
  let assistenciaNome = $("#tenantName").value.trim();
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
  await addDoc(collection(db, "lojas"), {
    nome: $("#tenantStoreName").value.trim(),
    assistenciaId,
    assistenciaNome,
    valorMensal: parseCurrency($("#tenantMonthlyPrice").value),
    formaPagamento: $("#tenantPaymentMethod").value.trim(),
    planoVencimento: $("#tenantDueDate").value,
    planoStatus: "em_dia",
    garantiaDias: 90,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  refs.tenantForm.reset();
  refs.tenantModal.close();
  toast("Assistência cadastrada.");
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", () => signOut(auth));
  $("#newOrderBtn").addEventListener("click", () => openOrderModal());
  $("#newOrderBtnSecondary").addEventListener("click", () => openOrderModal());
  $("#newClientBtn").addEventListener("click", () => refs.clientModal.showModal());
  $("#newUserBtn").addEventListener("click", () => openUserModal());
  $("#newTenantBtn").addEventListener("click", () => {
    fillTenantOptions();
    refs.tenantModal.showModal();
  });
  $("#tenantExisting").addEventListener("change", () => {
    const hasExisting = Boolean($("#tenantExisting").value);
    $("#tenantName").disabled = hasExisting;
    $("#tenantName").required = !hasExisting;
    if (hasExisting) $("#tenantName").value = "";
  });
  $("#resetPasswordBtn").addEventListener("click", resetUserPassword);
  $("#refreshBtn").addEventListener("click", () => {
    renderDashboard();
    renderOrders();
    toast("Painel atualizado.");
  });
  refs.storeSelector.addEventListener("change", () => {
    activeStoreId = refs.storeSelector.value;
    renderBrand();
    fillStoreFields();
    subscribeStoreData();
  });
  refs.orderForm.addEventListener("submit", saveOrder);
  refs.clientForm.addEventListener("submit", saveClient);
  refs.userForm.addEventListener("submit", saveUser);
  refs.tenantForm.addEventListener("submit", saveTenant);
  refs.storeForm.addEventListener("submit", saveStore);
  [refs.searchInput, refs.statusFilter, refs.dateFilter].forEach((input) => input.addEventListener("input", renderOrders));
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
    const button = event.target.closest("[data-support-action='enter-store']");
    if (!button) return;
    activeStoreId = button.dataset.id;
    refs.storeSelector.value = activeStoreId;
    renderBrand();
    fillStoreFields();
    subscribeStoreData();
    showSection("dashboard");
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
    showSection(location.hash?.replace("#", "") || "dashboard");
  } catch (error) {
  console.error("ERRO REAL:", error);

  toast(error.message, "error");
}
});

fillStatusOptions();
bindNavigation();
bindMasks();
bindEvents();
