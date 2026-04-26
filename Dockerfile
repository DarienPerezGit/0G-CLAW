FROM node:18-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production

CMD ["node", "dist/examples/basic-agent/agent.js"]
