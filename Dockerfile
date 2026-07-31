# Evaluation/benchmark runner. Waits for the stack (in-network) then runs the benches and
# writes CSVs to /app/results (bind-mounted to the host by docker-compose.eval.yml).
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. Include dev deps: vitest + allure-vitest run the
# correctness suite and emit allure-results (rendered to HTML on the host, which has Java).
COPY package.json package-lock.json* ./
RUN npm install

# Bench sources.
COPY lib ./lib
COPY bench-correctness ./bench-correctness
COPY bench-gas ./bench-gas
COPY bench-e2e ./bench-e2e
COPY bench-dao ./bench-dao
COPY config ./config
COPY vitest.config.mjs report.mjs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
