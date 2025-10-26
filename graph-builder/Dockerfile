FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl git

COPY package*.json ./
RUN npm ci

COPY . .
RUN mkdir -p /staging/parse /staging/enrich /staging/logs
RUN npm run build

CMD ["node", "dist/index.js"]
