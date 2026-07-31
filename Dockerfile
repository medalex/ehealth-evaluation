# Evaluation/benchmark runner. Waits for the stack (in-network) then runs the benches and
# writes CSVs to /app/results (bind-mounted to the host by docker-compose.eval.yml).
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Bench sources.
COPY lib ./lib
COPY bench-correctness ./bench-correctness
COPY bench-gas ./bench-gas
COPY bench-e2e ./bench-e2e
COPY bench-dao ./bench-dao
COPY config ./config
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
