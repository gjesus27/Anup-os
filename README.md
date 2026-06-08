# Anup OS - SaaS de Ordem de Servico

Sistema web estatico para assistencias tecnicas, com Firebase Auth, Firestore e cobranca SaaS via Asaas.

## O que foi preparado

- Login obrigatorio por e-mail e senha.
- Multi-tenant: uma assistencia pode ter varias lojas.
- Cada usuario acessa apenas as lojas liberadas em `usuarios/{uid}.lojaIds`.
- Niveis de usuario: suporte, admin da assistencia, admin da loja, gerente, tecnico, financeiro e somente leitura.
- Admins podem alterar dados da loja e gerenciar usuarios da mesma assistencia/loja.
- Dono/suporte Anup OS acessa a visao geral do SaaS e pode entrar em qualquer assistencia ou loja para suporte.
- Suporte pode cadastrar novas assistencias ou adicionar novas lojas a uma assistencia existente.
- Controle de plano por loja: mensal, anual ou pagamento unico.
- Integracao Asaas por Cloud Functions, sem expor a chave no frontend.
- Periodo de teste gratis configuravel, com primeira cobranca em `planoVencimento`.
- OS e clientes ficam separados em `lojas/{lojaId}/ordens` e `lojas/{lojaId}/clientes`.
- Links publicos continuam usando `public_ordens`, com dados sanitizados da OS.

## Acesso de suporte

O e-mail de suporte configurado e:

`g.jesus140606@gmail.com`

No primeiro login com esse e-mail, se o usuario ainda nao existir no Firebase Auth, o app tenta criar a conta com a senha digitada. Depois disso, ele cria o perfil `usuarios/{uid}` como `suporte`.

## Configuracao Firebase

1. Ative o provedor `Email/Password` em Firebase Authentication.
2. Publique as regras de `firestore.rules`.
3. Publique os indexes de `firestore.indexes.json`.
4. Publique a pasta raiz em GitHub Pages, Firebase Hosting ou outro host estatico.

## Configuracao Asaas

A chave da Asaas nunca deve ser colocada no `index.html` nem em `assets/js`.

Configure a chave como Secret do Firebase Functions:

```powershell
firebase functions:secrets:set ASAAS_API_KEY
```

Cole a chave de producao quando o Firebase CLI pedir. Depois publique as functions:

```powershell
firebase deploy --only functions,firestore:rules,firestore:indexes
```

Por padrao, as functions usam producao (`https://api.asaas.com/v3`). Para testar em sandbox, configure a variavel de ambiente `ASAAS_ENV=sandbox` antes do deploy.

### Webhook Asaas

Cadastre no painel Asaas a URL da function `asaasWebhook` depois do deploy. Ela atualiza `asaasStatus`, `planoStatus`, `statusCliente`, `asaasPaymentId` e `asaasInvoiceUrl` da loja.

Se quiser proteger o webhook com token adicional, configure `ASAAS_WEBHOOK_TOKEN` no ambiente da function e envie esse token pela query `?token=...` ou pelo header `x-asaas-webhook-token`.

## Estrutura principal do Firestore

- `usuarios/{uid}`: perfil, nivel e lojas permitidas.
- `assistencias/{assistenciaId}`: cadastro da assistencia.
- `lojas/{lojaId}`: dados da loja, plano, pagamento, Asaas e mensalidade.
- `asaas_logs/{logId}`: historico tecnico de criacao de cobrancas Asaas.
- `lojas/{lojaId}/ordens/{ordemId}`: dados internos da OS.
- `lojas/{lojaId}/clientes/{clienteId}`: clientes daquela loja.
- `public_ordens/{ordemId}`: copia publica da OS para `os.html?id=...`.

## Arquivos principais

- `index.html`: painel SaaS autenticado.
- `os.html`: acompanhamento publico da OS.
- `assets/js/app.js`: autenticacao, permissoes, multi-loja, CRUD, suporte e chamada Asaas.
- `assets/js/public.js`: consulta publica sanitizada.
- `assets/js/firebase.js`: configuracao Firebase.
- `assets/js/shared.js`: textos, status, funcoes comuns e e-mail de suporte.
- `assets/css/styles.css`: interface responsiva.
- `functions/index.js`: integracao segura com a API Asaas.
- `firestore.rules`: regras de acesso multi-tenant.
