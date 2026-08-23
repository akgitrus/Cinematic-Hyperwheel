# --- frontend build ---
FROM node:20-alpine AS frontend
WORKDIR /fe

# Must be build ARGs, not just runtime env vars on the container: Vite
# bakes these into the static bundle during `npm run build` below, so
# they need to exist at BUILD time, not when the container later starts
# (see apps/web/README.md, "About modal links"). Vite merges process.env
# over any .env file it finds via envDir - no .env file needs to exist
# in this build context for this to work.
ARG VITE_GITHUB_URL
ARG VITE_AUTHOR_URL
ENV VITE_GITHUB_URL=${VITE_GITHUB_URL}
ENV VITE_AUTHOR_URL=${VITE_AUTHOR_URL}

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