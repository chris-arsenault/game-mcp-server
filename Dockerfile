FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN chmod +x /app/entrypoint.sh /app/init-collections.sh
RUN npm run build

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
