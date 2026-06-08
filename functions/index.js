const admin = require("firebase-admin");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();

const db = admin.firestore();
const ASAAS_API_KEY = defineSecret("ASAAS_API_KEY");
const SUPPORT_EMAIL = "g.jesus140606@gmail.com";

function asaasBaseUrl() {
  return process.env.ASAAS_ENV === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

function onlyDigits(value = "") {
  return String(value).replace(/\D/g, "");
}

function addDaysISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function planValue(store) {
  if (store.tipoPlano === "unico") return Number(store.valorPagamentoUnico || store.valorMensal || 0);
  if (store.tipoPlano === "anual") return Number(store.valorMensal || 0) * 12;
  return Number(store.valorMensal || 0);
}

function cycleForPlan(store) {
  return store.tipoPlano === "anual" ? "YEARLY" : "MONTHLY";
}

async function assertSupport(context) {
  const email = context.auth?.token?.email?.toLowerCase();
  if (!context.auth || email !== SUPPORT_EMAIL) {
    throw new HttpsError("permission-denied", "Apenas o dono/suporte Anup pode gerar cobranças do SaaS.");
  }
  const userSnap = await db.collection("usuarios").doc(context.auth.uid).get();
  const role = userSnap.data()?.role;
  if (role && role !== "suporte") {
    throw new HttpsError("permission-denied", "Seu usuário não tem nível de suporte.");
  }
}

async function asaasRequest(path, options = {}) {
  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "User-Agent": "AnupOS/1.0",
      access_token: ASAAS_API_KEY.value(),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const description = body?.errors?.[0]?.description || `Erro Asaas HTTP ${response.status}`;
    throw new HttpsError("failed-precondition", description, body);
  }
  return body;
}

async function findOrCreateCustomer(storeId, store) {
  if (store.asaasCustomerId) return store.asaasCustomerId;

  const externalReference = `anup-store-${storeId}`;
  const existing = await asaasRequest(`/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`);
  if (existing?.data?.[0]?.id) return existing.data[0].id;

  const document = onlyDigits(store.cnpj);
  if (!document) {
    throw new HttpsError("invalid-argument", "Informe o CPF/CNPJ da loja/pagador antes de gerar cobrança Asaas.");
  }

  const customer = await asaasRequest("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: store.assistenciaNome ? `${store.assistenciaNome} - ${store.nome}` : store.nome,
      cpfCnpj: document,
      email: store.email || undefined,
      mobilePhone: onlyDigits(store.whatsapp) || undefined,
      externalReference,
      groupName: "Anup OS",
      notificationDisabled: false,
    }),
  });
  return customer.id;
}

async function firstPaymentForSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const result = await asaasRequest(`/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=1`);
  return result?.data?.[0] || null;
}

exports.createAsaasBilling = onCall(
  {
    region: "southamerica-east1",
    secrets: [ASAAS_API_KEY],
  },
  async (request) => {
    await assertSupport(request);
    const storeId = request.data?.storeId;
    const force = Boolean(request.data?.force);
    if (!storeId) throw new HttpsError("invalid-argument", "Informe a loja para gerar cobrança.");

    const storeRef = db.collection("lojas").doc(storeId);
    const storeSnap = await storeRef.get();
    if (!storeSnap.exists) throw new HttpsError("not-found", "Loja não encontrada.");
    const store = storeSnap.data();

    if (!force && (store.asaasSubscriptionId || store.asaasPaymentId)) {
      return {
        status: store.asaasStatus || "ja_gerado",
        customerId: store.asaasCustomerId || "",
        subscriptionId: store.asaasSubscriptionId || "",
        paymentId: store.asaasPaymentId || "",
        invoiceUrl: store.asaasInvoiceUrl || "",
        message: "Esta loja já possui cobrança Asaas vinculada.",
      };
    }

    const value = planValue(store);
    if (value <= 0) throw new HttpsError("invalid-argument", "Informe um valor de plano maior que zero.");

    const customerId = await findOrCreateCustomer(storeId, store);
    const billingType = store.asaasBillingType || "UNDEFINED";
    const trialDays = Number(store.trialDias || 0);
    const dueDate = store.planoVencimento || (trialDays > 0 ? addDaysISO(trialDays) : addDaysISO(0));
    const baseDescription = `Anup OS - ${store.assistenciaNome || "Assistência"} - ${store.nome}`;
    let asaasObject;
    let firstPayment = null;
    const update = {
      asaasCustomerId: customerId,
      asaasBillingType: billingType,
      asaasStatus: "gerado",
      valorPlanoAtual: value,
      planoVencimento: dueDate,
      trialDias: trialDays,
      trialAte: trialDays > 0 ? dueDate : "",
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (store.tipoPlano === "unico") {
      asaasObject = await asaasRequest("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType,
          value,
          dueDate,
          description: `${baseDescription} - pagamento único`,
          externalReference: `anup-store-${storeId}-payment-${Date.now()}`,
        }),
      });
      update.asaasPaymentId = asaasObject.id;
      update.asaasSubscriptionId = "";
      update.asaasInvoiceUrl = asaasObject.invoiceUrl || asaasObject.bankSlipUrl || "";
      update.statusCliente = trialDays > 0 ? "teste" : "ativo";
    } else {
      asaasObject = await asaasRequest("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType,
          value,
          nextDueDate: dueDate,
          cycle: cycleForPlan(store),
          description: `${baseDescription} - plano ${store.tipoPlano === "anual" ? "anual" : "mensal"}`,
          externalReference: `anup-store-${storeId}-subscription`,
        }),
      });
      firstPayment = await firstPaymentForSubscription(asaasObject.id);
      update.asaasSubscriptionId = asaasObject.id;
      update.asaasPaymentId = firstPayment?.id || "";
      update.asaasInvoiceUrl = firstPayment?.invoiceUrl || "";
      update.statusCliente = trialDays > 0 ? "teste" : "ativo";
    }

    await storeRef.update(update);
    await db.collection("asaas_logs").add({
      lojaId: storeId,
      assistenciaId: store.assistenciaId || "",
      tipoPlano: store.tipoPlano || "mensal",
      valor: value,
      billingType,
      asaasCustomerId: customerId,
      asaasSubscriptionId: update.asaasSubscriptionId || "",
      asaasPaymentId: update.asaasPaymentId || "",
      criadoPor: request.auth.token.email,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      status: update.asaasStatus,
      customerId,
      subscriptionId: update.asaasSubscriptionId || "",
      paymentId: update.asaasPaymentId || "",
      invoiceUrl: update.asaasInvoiceUrl || "",
      trialEndsAt: update.trialAte,
      message: store.tipoPlano === "unico" ? "Cobrança única Asaas gerada." : "Assinatura Asaas gerada.",
    };
  }
);

exports.asaasWebhook = onRequest(
  {
    region: "southamerica-east1",
    secrets: [ASAAS_API_KEY],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    const expectedWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (
      expectedWebhookToken &&
      req.get("x-asaas-webhook-token") !== expectedWebhookToken &&
      req.query.token !== expectedWebhookToken
    ) {
      res.status(401).send("Unauthorized");
      return;
    }
    const payment = req.body?.payment || req.body;
    const paymentId = payment?.id;
    const subscriptionId = payment?.subscription;
    if (!paymentId && !subscriptionId) {
      res.status(200).send("ignored");
      return;
    }

    const query = subscriptionId
      ? db.collection("lojas").where("asaasSubscriptionId", "==", subscriptionId).limit(1)
      : db.collection("lojas").where("asaasPaymentId", "==", paymentId).limit(1);
    const snap = await query.get();
    if (!snap.empty) {
      const status = payment?.status || req.body?.event || "webhook";
      const paid = ["RECEIVED", "CONFIRMED"].includes(status);
      const overdue = status === "OVERDUE";
      await snap.docs[0].ref.update({
        asaasStatus: status,
        asaasPaymentId: paymentId || snap.docs[0].data().asaasPaymentId || "",
        asaasInvoiceUrl: payment?.invoiceUrl || snap.docs[0].data().asaasInvoiceUrl || "",
        planoStatus: paid ? "em_dia" : overdue ? "devendo" : snap.docs[0].data().planoStatus || "em_dia",
        statusCliente: paid ? "ativo" : snap.docs[0].data().statusCliente || "ativo",
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    res.status(200).send("ok");
  }
);
