FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --omit=dev
COPY app/client/package.json app/client/package-lock.json app/client/
RUN cd app/client && npm ci --include=dev
COPY app app
COPY challenge/dataset challenge/dataset
RUN cd app/client && npx vite build && rm -rf node_modules
ENV DATA_DIR=/data LLM_CACHE_DIR=/data/llm-cache PORT=8080
EXPOSE 8080
CMD ["node", "--no-warnings", "app/server/index.js"]
