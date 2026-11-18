FROM node:20-alpine AS client-build
WORKDIR /app
COPY package*.json ./
COPY client/package*.json client/
COPY server/package*.json server/
RUN npm ci
COPY client client
COPY scripts/build-client.mjs scripts/build-client.mjs
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY client/package*.json client/
COPY server/package*.json server/
RUN npm ci --omit=dev
COPY server server
COPY kit kit
COPY --from=client-build /app/client/dist client/dist
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "server"]
