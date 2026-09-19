FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && apt-get clean
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY generate_synthetic_data.py ./
COPY pytest.ini ./
COPY tests/ tests/
COPY --from=frontend /build/dist frontend/dist
ENV CHURN_DATA_DIR=/app/data/raw CHURN_CACHE_DIR=/app/.runtime PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
