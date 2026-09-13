FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
ENV PORT=7860 DEMO_HOST=0.0.0.0 CLOUD_DEMO=1 DEMO_STATE_DIR=/tmp/acceptance-sessions
EXPOSE 7860
CMD ["node", "v3/public-demo.mjs"]
