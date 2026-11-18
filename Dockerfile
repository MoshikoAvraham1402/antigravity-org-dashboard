# Build Stage: React + Vite SPA
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Hardened Runtime Stage: Non-root FastAPI + Uvicorn with read-only app tree
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN groupadd --gid 10001 appuser && \
    useradd --uid 10001 --gid 10001 --shell /usr/sbin/nologin --no-create-home appuser

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Make entire /app tree immutable to the unprivileged runtime user
RUN chown -R root:root /app && \
    chmod -R u=rwX,go=rX /app && \
    chmod -R a-w /app

USER 10001:10001
EXPOSE 8080

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header", "--limit-concurrency", "50", "--timeout-keep-alive", "5"]
