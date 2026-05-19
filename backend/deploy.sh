#!/usr/bin/env bash
set -euo pipefail

# Resolve monorepo root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" == "${line}" ]] && continue
    if [[ "${value}" =~ ^\".*\"$ || "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "${key}=${value}"
  done < "${ENV_FILE}"
fi

REQUIRED_ENV=(
  FIREBASE_CREDENTIALS
  OPENAI_API_KEY
  GMAIL_USER
  GMAIL_PASSWORD
  SCRAPE_SECRET
)

for key in "${REQUIRED_ENV[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "✗ ${key} not found in .env or environment" >&2
    exit 1
  fi
done

# ── Config ───────────────────────────────────────────────────────────────────
PROJECT="${PROJECT:-eiwittens}"
SERVICE="${SERVICE:-eiwittens-backend}"
SCRAPE_JOB="${SCRAPE_JOB:-daily-scrape-runner}"
REGION="europe-west4"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"
ENV_VARS="^|^FIREBASE_CREDENTIALS=${FIREBASE_CREDENTIALS}|OPENAI_API_KEY=${OPENAI_API_KEY}|GMAIL_USER=${GMAIL_USER}|GMAIL_PASSWORD=${GMAIL_PASSWORD}|SCRAPE_SECRET=${SCRAPE_SECRET}|ALERT_RECIPIENTS=${ALERT_RECIPIENTS:-huntymonster@gmail.com,gieriggroeien.nl@gmail.com}|ALLOWED_WARNINGS=${ALLOWED_WARNINGS:-15}|CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:3000}|SCRAPE_CONCURRENCY=${SCRAPE_CONCURRENCY:-3}|SCRAPE_STALE_AFTER_MS=${SCRAPE_STALE_AFTER_MS:-900000}"

echo "▶ Target project: ${PROJECT}"
echo "▶ Target Cloud Run region: ${REGION}"

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
  --set-env-vars "${ENV_VARS}" \
  --allow-unauthenticated

SERVICE_URL="$(gcloud run services describe ${SERVICE} --region ${REGION} --project ${PROJECT} --format='value(status.url)')"
echo "✓ Deployed: ${SERVICE_URL}"

# ── Cloud Run Job (daily scrape runner) ──────────────────────────────────────
echo "▶ Deploying Cloud Run Job '${SCRAPE_JOB}'..."
gcloud run jobs deploy "${SCRAPE_JOB}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --set-env-vars "${ENV_VARS}" \
  --command node \
  --args backend/dist/jobs/scrape.js \
  --task-timeout 2h \
  --max-retries 2

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
SCHEDULER_SERVICE_ACCOUNT="${SCHEDULER_SERVICE_ACCOUNT:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "▶ Granting Scheduler permission to execute '${SCRAPE_JOB}'..."
gcloud run jobs add-iam-policy-binding "${SCRAPE_JOB}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --member "serviceAccount:${SCHEDULER_SERVICE_ACCOUNT}" \
  --role roles/run.invoker \
  --quiet

# ── Scheduler (daily scrape) ─────────────────────────────────────────────────
JOB_NAME="daily-scrape"
SCHEDULE="0 6 * * *"   # every day at 06:00 UTC
JOB_RUN_URI="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${SCRAPE_JOB}:run"

echo "▶ Creating/updating Cloud Scheduler job..."
if gcloud scheduler jobs describe "${JOB_NAME}" --location "${REGION}" --project "${PROJECT}" &>/dev/null; then
  gcloud scheduler jobs delete "${JOB_NAME}" \
    --location "${REGION}" \
    --project "${PROJECT}" \
    --quiet
fi

gcloud scheduler jobs create http "${JOB_NAME}" \
  --location "${REGION}" \
  --project "${PROJECT}" \
  --schedule "${SCHEDULE}" \
  --time-zone "Europe/Amsterdam" \
  --uri "${JOB_RUN_URI}" \
  --http-method POST \
  --oauth-service-account-email "${SCHEDULER_SERVICE_ACCOUNT}" \
  --attempt-deadline 300s

echo "✓ Scheduler job '${JOB_NAME}' configured (${SCHEDULE}) → ${SCRAPE_JOB}"
