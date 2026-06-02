# Anup OS - SaaS de Ordem de Serviço

Sistema web estático para assistências técnicas, com Firebase Auth e Firestore.

## O que foi preparado

- Login obrigatório por e-mail e senha.
- Multi-tenant: uma assistência pode ter várias lojas.
- Cada usuário acessa apenas as lojas liberadas em `usuarios/{uid}.lojaIds`.
- Níveis de usuário: suporte, admin da assistência, admin da loja, gerente, técnico, financeiro e somente leitura.
- Admins podem alterar dados da loja e gerenciar usuários da mesma assistência/loja.
- Suporte Anup OS acessa a visão geral do SaaS e pode entrar em qualquer loja.
- Suporte pode cadastrar novas assistências ou adicionar novas lojas a uma assistência existente.
- Controle de mensalidade por loja: valor, forma de pagamento, vencimento e status.
- OS e clientes ficam separados em `lojas/{lojaId}/ordens` e `lojas/{lojaId}/clientes`.
- Links públicos continuam usando `public_ordens`, com dados sanitizados da OS.

## Acesso de suporte

O e-mail de suporte configurado é:

`g.jesus140606@gmail.com`

No primeiro login com esse e-mail, se o usuário ainda não existir no Firebase Auth, o app tenta criar a conta com a senha digitada. Depois disso, ele cria o perfil `usuarios/{uid}` como `suporte`.

## Configuração necessária no Firebase

1. Ative o provedor `Email/Password` em Firebase Authentication.
2. Publique as regras de `firestore.rules`.
3. Publique a pasta raiz em GitHub Pages, Firebase Hosting ou outro host estático.

## Estrutura principal do Firestore

- `usuarios/{uid}`: perfil, nível e lojas permitidas.
- `assistencias/{assistenciaId}`: cadastro da assistência.
- `lojas/{lojaId}`: dados da loja, plano, pagamento e mensalidade.
- `lojas/{lojaId}/ordens/{ordemId}`: dados internos da OS.
- `lojas/{lojaId}/clientes/{clienteId}`: clientes daquela loja.
- `public_ordens/{ordemId}`: cópia pública da OS para `os.html?id=...`.

## Arquivos principais

- `index.html`: painel SaaS autenticado.
- `os.html`: acompanhamento público da OS.
- `assets/js/app.js`: autenticação, permissões, multi-loja, CRUD e suporte.
- `assets/js/public.js`: consulta pública sanitizada.
- `assets/js/firebase.js`: configuração Firebase.
- `assets/js/shared.js`: textos, status, funções comuns e e-mail de suporte.
- `assets/css/styles.css`: interface responsiva.
- `firestore.rules`: regras de acesso multi-tenant.
