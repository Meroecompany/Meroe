#!/bin/bash
# ============================================================
# MEROE — Ligar o Vercel ao Railway (correr depois do Railway dar o URL)
# USO: ./conectar-railway.sh meu-projeto.up.railway.app
# ============================================================
set -e

if [ -z "$1" ]; then
  echo "❌ Uso: ./conectar-railway.sh SEU-PROJETO.up.railway.app"
  echo "   (sem https://, copiar de: Railway Dashboard → Settings → Networking → Generate Domain)"
  exit 1
fi

RAILWAY_URL="$1"
RAILWAY_URL="${RAILWAY_URL#https://}"
RAILWAY_URL="${RAILWAY_URL#http://}"

FILE="meroe-website/vercel.json"

if [ ! -f "$FILE" ]; then
  echo "❌ Não encontrei $FILE — correr este script na raiz do projecto (meroe_v2/)"
  exit 1
fi

sed -i.bak "s|SEU-PROJETO\.up\.railway\.app|${RAILWAY_URL}|g" "$FILE"

# Validar JSON
python3 -c "import json; json.load(open('$FILE')); print('✅ vercel.json válido')" || {
  echo "❌ Erro — a restaurar backup"
  mv "${FILE}.bak" "$FILE"
  exit 1
}

rm -f "${FILE}.bak"
echo "✅ vercel.json actualizado para apontar para: https://${RAILWAY_URL}"
echo ""
echo "Próximo passo:"
echo "  cd meroe-website"
echo "  git add vercel.json"
echo "  git commit -m 'chore: ligar frontend ao backend Railway'"
echo "  git push origin main"
