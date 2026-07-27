#!/usr/bin/env bash
# Sobe um servidor HTTP local e abre a proposta no navegador.
# Uso: ./servir.sh
set -e
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT/proposta.html"

echo "Servindo em $URL  (Ctrl+C para parar)"
( sleep 1 && open "$URL" ) &
python3 -m http.server "$PORT"
