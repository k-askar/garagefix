# Backend — FastAPI + Motor + JWT
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps (bcrypt / cryptography wheels usually enough on slim; keep it lean)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8001

# Do NOT bake secrets. Provide MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_EMAIL,
# ADMIN_PASSWORD, EMERGENT_EMAIL_KEY, WEBHOOK_CRON_SECRET at runtime.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
