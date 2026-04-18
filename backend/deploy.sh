#!/usr/bin/env bash
set -euo pipefail

# Resolve monorepo root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Config ───────────────────────────────────────────────────────────────────
PROJECT="eiwittens"
SERVICE="eiwittens-backend"
REGION="europe-west4"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"

# ── Build & push ─────────────────────────────────────────────────────────────
echo "▶ Building and pushing Docker image..."
gcloud builds submit \
  --config="backend/cloudbuild.yaml" \
  --project "${PROJECT}" \
  "${REPO_ROOT}"

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "▶ Deploying to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --platform managed \
  --allow-unauthenticated

echo "✓ Deployed: $(gcloud run services describe ${SERVICE} --region ${REGION} --project ${PROJECT} --format='value(status.url)')"
