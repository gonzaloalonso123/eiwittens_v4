#!/usr/bin/env bash
set -euo pipefail

# Resolve monorepo root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  export SCRAPE_SECRET="$(grep '^SCRAPE_SECRET=' "${ENV_FILE}" | cut -d'=' -f2-)"
fi

if [[ -z "${SCRAPE_SECRET:-}" ]]; then
  echo "✗ SCRAPE_SECRET not found in .env or environment" >&2
  exit 1
fi

# ── Config ───────────────────────────────────────────────────────────────────
PROJECT="eiwittens"
SERVICE="eiwittens-backend"
REGION="europe-west4"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"

# ── Build & push ─────────────────────────────────────────────────────────────
echo "▶ Building and pushing Docker image..."
gcloud builds submit \
  --config="${REPO_ROOT}/backend/cloudbuild.yaml" \
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

SERVICE_URL="$(gcloud run services describe ${SERVICE} --region ${REGION} --project ${PROJECT} --format='value(status.url)')"
echo "✓ Deployed: ${SERVICE_URL}"

# ── Scheduler (daily scrape) ─────────────────────────────────────────────────
JOB_NAME="daily-scrape"
SCHEDULE="0 6 * * *"   # every day at 06:00 UTC

echo "▶ Creating/updating Cloud Scheduler job..."
if gcloud scheduler jobs describe "${JOB_NAME}" --location "${REGION}" --project "${PROJECT}" &>/dev/null; then
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --location "${REGION}" \
    --project "${PROJECT}" \
    --schedule "${SCHEDULE}" \
    --uri "${SERVICE_URL}/scrape" \
    --http-method POST \
    --headers "Authorization=Bearer ${SCRAPE_SECRET}" \
    --attempt-deadline 1800s
else
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --location "${REGION}" \
    --project "${PROJECT}" \
    --schedule "${SCHEDULE}" \
    --time-zone "Europe/Amsterdam" \
    --uri "${SERVICE_URL}/scrape" \
    --http-method POST \
    --headers "Authorization=Bearer ${SCRAPE_SECRET}" \
    --attempt-deadline 1800s
fi

echo "✓ Scheduler job '${JOB_NAME}' configured (${SCHEDULE})"
