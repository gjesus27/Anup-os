param(
  [string]$Email = "g.jesus140606@gmail.com",
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [string]$ApiKey = "AIzaSyB1mJL2R5DiRXNrKaLCtvMxu6Oo-5zqM1o",
  [string]$ProjectId = "anup-os"
)

$ErrorActionPreference = "Stop"

function Invoke-FirebaseAuth {
  param(
    [string]$Endpoint,
    [hashtable]$Body
  )

  $uri = "https://identitytoolkit.googleapis.com/v1/accounts:$Endpoint`?key=$ApiKey"
  try {
    return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
  } catch {
    $response = $_.Exception.Response
    if ($response) {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $details = $reader.ReadToEnd()
      throw "Firebase Auth error: $details"
    }
    throw
  }
}

function Get-AuthSession {
  try {
    return Invoke-FirebaseAuth -Endpoint "signInWithPassword" -Body @{
      email = $Email
      password = $Password
      returnSecureToken = $true
    }
  } catch {
    $message = $_.Exception.Message
    if ($message -match "EMAIL_NOT_FOUND") {
      Write-Host "Criando usuário de suporte no Firebase Auth..."
      return Invoke-FirebaseAuth -Endpoint "signUp" -Body @{
        email = $Email
        password = $Password
        returnSecureToken = $true
      }
    }
    throw
  }
}

function ConvertTo-FirestoreValue {
  param($Value)

  if ($null -eq $Value) {
    return @{ nullValue = $null }
  }

  if ($Value -is [bool]) {
    return @{ booleanValue = $Value }
  }

  if ($Value -is [int] -or $Value -is [long]) {
    return @{ integerValue = "$Value" }
  }

  if ($Value -is [float] -or $Value -is [double] -or $Value -is [decimal]) {
    return @{ doubleValue = [double]$Value }
  }

  if ($Value -is [datetime]) {
    return @{ timestampValue = $Value.ToUniversalTime().ToString("o") }
  }

  if ($Value -is [array]) {
    return @{
      arrayValue = @{
        values = @($Value | ForEach-Object { ConvertTo-FirestoreValue $_ })
      }
    }
  }

  if ($Value -is [hashtable]) {
    $fields = @{}
    foreach ($key in $Value.Keys) {
      $fields[$key] = ConvertTo-FirestoreValue $Value[$key]
    }
    return @{ mapValue = @{ fields = $fields } }
  }

  return @{ stringValue = [string]$Value }
}

function ConvertTo-FirestoreDocument {
  param([hashtable]$Data)

  $fields = @{}
  foreach ($key in $Data.Keys) {
    $fields[$key] = ConvertTo-FirestoreValue $Data[$key]
  }
  return @{ fields = $fields }
}

function Set-FirestoreDocument {
  param(
    [string]$Path,
    [hashtable]$Data,
    [string]$Token
  )

  $uri = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents/$Path"
  $headers = @{ Authorization = "Bearer $Token" }
  $body = ConvertTo-FirestoreDocument $Data | ConvertTo-Json -Depth 30
  Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -ContentType "application/json" -Body $body | Out-Null
  Write-Host "OK  $Path"
}

$session = Get-AuthSession
$now = [datetime]::UtcNow
$nextDue = $now.AddMonths(1).ToString("yyyy-MM-dd")
$supportUid = $session.localId
$token = $session.idToken

$assistenciaId = "anup_os_admin"
$lojaId = "anup_os_suporte"

Write-Host "Inicializando Firestore do projeto $ProjectId..."

Set-FirestoreDocument -Token $token -Path "sistema/config" -Data @{
  nome = "Anup OS"
  versaoSchema = 1
  moeda = "BRL"
  suporteEmail = $Email
  diasAvisoVencimento = 5
  criadoEm = $now
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "catalogos/status_os" -Data @{
  items = @(
    "Aguardando análise",
    "Orçamento enviado",
    "Aguardando aprovação",
    "Aprovado",
    "Em conserto",
    "Aguardando peça",
    "Finalizado",
    "Entregue",
    "Cancelado"
  )
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "catalogos/niveis_usuario" -Data @{
  items = @(
    "suporte",
    "assistencia_admin",
    "loja_admin",
    "gerente",
    "tecnico",
    "financeiro",
    "leitura"
  )
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "catalogos/formas_pagamento" -Data @{
  items = @("Pix", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Transferência")
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "assistencias/$assistenciaId" -Data @{
  nome = "Anup OS Administração"
  ativo = $true
  criadoEm = $now
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "lojas/$lojaId" -Data @{
  nome = "Anup OS Suporte"
  assistenciaId = $assistenciaId
  assistenciaNome = "Anup OS Administração"
  logoUrl = ""
  endereco = ""
  cnpj = ""
  instagram = ""
  email = ""
  site = ""
  cep = ""
  cidade = ""
  estado = ""
  whatsapp = ""
  garantiaDias = 90
  valorMensal = 0
  formaPagamento = "Interno"
  planoVencimento = $nextDue
  planoStatus = "em_dia"
  ativo = $true
  criadoEm = $now
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "usuarios/$supportUid" -Data @{
  nome = "Suporte Anup OS"
  email = $Email.ToLowerInvariant()
  role = "suporte"
  assistenciaId = $null
  lojaIds = @()
  ativo = $true
  criadoEm = $now
  atualizadoEm = $now
}

Set-FirestoreDocument -Token $token -Path "sistema/schema" -Data @{
  assistencias = "assistencias/{assistenciaId}"
  lojas = "lojas/{lojaId}"
  usuarios = "usuarios/{uid}"
  ordens = "lojas/{lojaId}/ordens/{ordemId}"
  clientes = "lojas/{lojaId}/clientes/{clienteId}"
  publicOrdens = "public_ordens/{ordemId}"
  atualizadoEm = $now
}

Write-Host ""
Write-Host "Banco inicializado com sucesso."
Write-Host "UID do suporte: $supportUid"
