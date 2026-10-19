FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# The server bundle is self-contained, so the runtime image needs no node_modules.
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
ENV NODE_ENV=production
EXPOSE 2567
USER node
CMD ["node", "server/dist/index.js"]
