# --- frontend build ---
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY apps/web/frontend/package*.json ./
RUN npm ci
COPY apps/web/frontend/ ./
RUN npm run build

# --- backend runtime ---
FROM python:3.11-slim AS backend
WORKDIR /app

COPY packages/hyperwheel-recommender /app/packages/hyperwheel-recommender
COPY apps/web/backend /app/apps/web/backend
RUN pip install --no-cache-dir -e /app/packages/hyperwheel-recommender \
    && pip install --no-cache-dir -r /app/apps/web/backend/requirements.txt

COPY --from=frontend /fe/dist /app/apps/web/frontend/dist

WORKDIR /app/apps/web/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]