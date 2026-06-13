# MEROE — Registos DNS Completos
# Configurar no Cloudflare → DNS → Add record
# ============================================
# COPIAR EXACTAMENTE — não alterar os valores
# ============================================

## ── MX (receber emails) ──────────────────────────────────────

Type: MX  | Name: @  | Mail server: mx.zoho.com   | Priority: 10  | TTL: Auto
Type: MX  | Name: @  | Mail server: mx2.zoho.com  | Priority: 20  | TTL: Auto
Type: MX  | Name: @  | Mail server: mx3.zoho.com  | Priority: 50  | TTL: Auto


## ── SPF (autorizar envio) ────────────────────────────────────

Type: TXT | Name: @ | TTL: Auto
Content:  v=spf1 include:zoho.com include:transmail.net ~all


## ── DMARC (política de segurança) ───────────────────────────

Type: TXT | Name: _dmarc | TTL: Auto
Content:  v=DMARC1; p=quarantine; rua=mailto:admin@meroe-engineering.com; ruf=mailto:admin@meroe-engineering.com; pct=100; adkim=s; aspf=s


## ── DKIM (obter no Zoho Mail → Settings → Domains → DKIM) ──

Type: TXT | Name: zoho._domainkey | TTL: Auto
Content:  [COLAR AQUI O VALOR DADO PELO ZOHO — começa com v=DKIM1; k=rsa; p=...]


## ── CNAME website → Vercel ───────────────────────────────────

Type: CNAME | Name: www    | Target: cname.vercel-dns.com | TTL: Auto
Type: A     | Name: @      | IPv4:   76.76.21.21           | TTL: Auto
# Nota: o IP 76.76.21.21 é o Vercel. Verificar em vercel.com/docs/projects/domains


## ── CNAME plataforma (subdomínio) ────────────────────────────

Type: CNAME | Name: platform | Target: cname.vercel-dns.com | TTL: Auto
# Acesso em: https://platform.meroe-engineering.com


## ── CNAME API backend (Railway) ──────────────────────────────

Type: CNAME | Name: api | Target: [DOMÍNIO DADO PELO RAILWAY] | TTL: Auto
# Exemplo: meroe-api.up.railway.app
# Acesso em: https://api.meroe-engineering.com


## ── TXT verificação Zoho ──────────────────────────────────────

Type: TXT | Name: @ | TTL: Auto
Content:  zoho-verification=[CÓDIGO DADO PELO ZOHO DURANTE SETUP]


## ── ESTADO ESPERADO APÓS CONFIGURAÇÃO ───────────────────────

Verificar em: mxtoolbox.com/SuperTool.aspx

✅ MX Lookup → mostra mx.zoho.com, mx2.zoho.com, mx3.zoho.com
✅ SPF Lookup → pass (include:zoho.com)
✅ DKIM Lookup → record found
✅ DMARC Lookup → policy: quarantine
✅ HTTP Headers → meroe-engineering.com resolve para Vercel
✅ mail-tester.com → score 10/10
