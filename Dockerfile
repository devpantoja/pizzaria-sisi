# Dockerfile — Sisi Pizzeria online
# Multi-stage: build (compila native module better-sqlite3) + runtime (imagem final enxuta)

FROM node:20-alpine AS build
WORKDIR /app
# better-sqlite3 precisa de python + build tools pro node-gyp
RUN apk add --no-cache python3 make g++ sqlite
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
# so runtime — sqlite pra CLI de debug, tzdata pra America/Sao_Paulo
RUN apk add --no-cache sqlite tzdata && \
    cp /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime && \
    echo "America/Sao_Paulo" > /etc/timezone

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=America/Sao_Paulo

COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY server.js db.js cardapio.js pedidos.js propagandas.js relatorio.js backup.js auth.js ./
COPY public ./public
COPY manual ./manual

# Volume pra persistir o banco entre restarts / redeploys.
# Criado com dono `node` pra o processo conseguir escrever.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

EXPOSE 3000

USER node

CMD ["node", "server.js"]
