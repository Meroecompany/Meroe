# EMAIL CORPORATIVO MEROE — Guia Completo
# Zoho Mail Gratuito + Domínio meroe-engineering.com
# =====================================================
# Tempo estimado: 2-3 horas (inclui propagação DNS)
# Custo: 0 USD (Zoho gratuito) + ~12 USD/ano (domínio)
# =====================================================

## PASSO 0 — Comprar o domínio (se ainda não tiver)

1. Ir a namecheap.com
2. Pesquisar: meroe-engineering.com
3. Adicionar ao carrinho (~12 USD/ano)
4. Checkout → criar conta Namecheap
5. Pagar com cartão de crédito/débito
6. ✅ Domínio activo em ~15 minutos

Alternativa: godaddy.com (mesmo processo, preço similar)


## PASSO 1 — Criar conta Cloudflare (gerir DNS — gratuito)

Cloudflare é mais rápido e seguro que o DNS do Namecheap.
Usaremos o Cloudflare para todos os registos DNS.

1. Ir a cloudflare.com → Sign Up → criar conta gratuita
2. Add a Site → digitar: meroe-engineering.com
3. Seleccionar plano Free → Continue
4. Cloudflare mostra os registos DNS actuais → Continue
5. Cloudflare dá 2 nameservers, por exemplo:
      aria.ns.cloudflare.com
      bob.ns.cloudflare.com
6. Copiar esses 2 nameservers

7. Ir ao Namecheap → Domain List → meroe-engineering.com → Manage
8. Nameservers → seleccionar "Custom DNS"
9. Colar os 2 nameservers do Cloudflare → Save
10. Aguardar 24-48h para propagação (normalmente < 1h)

✅ A partir daqui, toda a gestão DNS é feita no Cloudflare


## PASSO 2 — Criar conta Zoho Mail gratuita

1. Ir a zoho.com/mail
2. Clicar em "Sign Up For Free"
3. Seleccionar plano "Forever Free" (até 5 utilizadores)
4. Preencher:
   - Email pessoal (para receber confirmações)
   - Password segura
5. Verificar o email pessoal
6. ✅ Conta Zoho criada


## PASSO 3 — Adicionar domínio ao Zoho Mail

1. No Zoho Mail → Settings → Domains
2. Clicar em "Add Domain"
3. Digitar: meroe-engineering.com
4. Zoho vai pedir para verificar que é dono do domínio

### Verificação do domínio (método TXT):

Zoho mostra um registo TXT parecido com:
   Name/Host: @
   Value:     zoho-verification=zb12345678.zmverify.zoho.com
   TTL:       300

5. Ir ao Cloudflare → meroe-engineering.com → DNS
6. Clicar "Add record"
7. Type: TXT | Name: @ | Content: [valor do Zoho] | TTL: Auto
8. Save
9. Voltar ao Zoho → clicar "Verify"
10. Aguardar até 10 minutos
11. ✅ Domínio verificado


## PASSO 4 — Configurar registos MX (emails entram aqui)

Os registos MX dizem ao mundo onde entregar os emails para @meroe-engineering.com

No Cloudflare → DNS → Add record (3 vezes):

### Registo MX 1:
   Type: MX
   Name: @
   Mail server: mx.zoho.com
   Priority: 10
   TTL: Auto

### Registo MX 2:
   Type: MX
   Name: @
   Mail server: mx2.zoho.com
   Priority: 20
   TTL: Auto

### Registo MX 3:
   Type: MX
   Name: @
   Mail server: mx3.zoho.com
   Priority: 50
   TTL: Auto

✅ Emails a chegar ao @meroe-engineering.com


## PASSO 5 — Configurar SPF (evitar spam)

SPF diz ao mundo quais servidores podem enviar email pelo @meroe-engineering.com

No Cloudflare → DNS → Add record:

   Type: TXT
   Name: @
   Content: v=spf1 include:zoho.com ~all
   TTL: Auto

✅ Emails da MEROE não vão para spam


## PASSO 6 — Configurar DKIM (autenticação criptográfica)

1. No Zoho Mail → Settings → Domains → meroe-engineering.com
2. Clicar em "DKIM" → "Add Selector"
3. Zoho gera uma chave DKIM, mostrando algo como:
   Selector: zoho
   Value: v=DKIM1; k=rsa; p=MIGfMA0G... [chave longa]

4. No Cloudflare → DNS → Add record:
   Type: TXT
   Name: zoho._domainkey
   Content: [colar a chave do Zoho]
   TTL: Auto

5. Voltar ao Zoho → verificar DKIM
✅ Emails autenticados criptograficamente


## PASSO 7 — Configurar DMARC (política de segurança)

No Cloudflare → DNS → Add record:

   Type: TXT
   Name: _dmarc
   Content: v=DMARC1; p=quarantine; rua=mailto:admin@meroe-engineering.com; pct=100
   TTL: Auto

✅ Política de segurança de email activa


## PASSO 8 — Criar as contas de email

No Zoho Mail → Settings → Users → Add User

### Contas a criar (plano gratuito = 5 contas):

PRIORIDADE 1 (criar primeiro):
   1. admin@meroe-engineering.com
      Nome: MEROE Admin
      Função: Administração geral, acesso total

   2. info@meroe-engineering.com
      Nome: MEROE Info
      Função: Contacto público geral

   3. hr@meroe-engineering.com
      Nome: MEROE Recursos Humanos
      Função: Recrutamento e plataforma de talentos

   4. operations@meroe-engineering.com
      Nome: MEROE Operations
      Função: Operações e projectos

   5. engineering@meroe-engineering.com
      Nome: MEROE Engineering
      Função: Equipa técnica

### Contas funcionais (aliases — sem custo extra):
No Zoho, contas alias reencaminham para uma conta existente.
Settings → Email Aliases → Add Alias

   projects@       → reencaminhar para operations@
   turnarounds@    → reencaminhar para operations@
   commercial@     → reencaminhar para info@
   finance@        → reencaminhar para admin@
   compliance@     → reencaminhar para admin@
   noreply@        → conta de envio automático (plataforma)


## PASSO 9 — Configurar conta de envio automático (plataforma)

Esta conta é usada pelo sistema para enviar emails automáticos
(confirmação de registo, aprovação de perfil, etc.)

1. Criar conta: noreply@meroe-engineering.com
2. No Zoho → gerar "App Password" (para usar no código):
   Settings → Security → App Passwords → Generate
   Copiar a password gerada

3. Actualizar o ficheiro .env da plataforma:
   SMTP_HOST=smtp.zoho.com
   SMTP_PORT=587
   SMTP_USER=noreply@meroe-engineering.com
   SMTP_PASS=APP_PASSWORD_GERADA_ACIMA


## PASSO 10 — Testar tudo

1. Enviar email de admin@ para uma conta pessoal → deve chegar
2. Enviar email de conta pessoal para info@ → deve chegar ao Zoho
3. Verificar no MXToolbox (mxtoolbox.com/SuperTool.aspx):
   - MX Lookup: meroe-engineering.com → deve mostrar mx.zoho.com
   - SPF Lookup: deve mostrar "v=spf1 include:zoho.com"
   - DMARC Lookup: deve mostrar a política configurada
4. Verificar score de email em mail-tester.com:
   - Deve obter 9-10/10

✅ Email corporativo 100% funcional


## UPGRADE FUTURO — Google Workspace

Quando a MEROE crescer e precisar de mais contas:
- Google Workspace Business Starter: ~6 USD/utilizador/mês
- Inclui Gmail, Google Drive, Google Meet, Google Calendar
- Migração do Zoho para Google: export/import simples
- Manter o mesmo domínio meroe-engineering.com


## CONFIGURAÇÃO NO TELEMÓVEL

### iPhone/iOS:
1. Definições → Mail → Contas → Adicionar Conta → Outro
2. Introduzir email e password
3. IMAP: imap.zoho.com (porta 993, SSL)
4. SMTP: smtp.zoho.com (porta 587, STARTTLS)

### Android:
1. Gmail app → Adicionar conta → Outra
2. Mesmo processo

### Outlook/Desktop:
1. Ficheiro → Adicionar conta
2. Configuração manual → IMAP
3. Mesmas configurações acima
