FROM node:20-alpine

WORKDIR /app

# Instal·la dependències primer (layer cache)
COPY package.json ./
RUN npm install --production

# Copia el codi del servidor
COPY server.js database.js ./

EXPOSE 3000

CMD ["node", "server.js"]
