FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
WORKDIR /app

COPY services/agent-hub-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/common ./common
RUN pip install --no-cache-dir ./common
RUN useradd --system --uid 10001 --create-home appuser
COPY services/agent-hub-service/app ./app


COPY services/agent-hub-service/account-link/dist ./account-link/dist
COPY services/agent-hub-service/account-link/static ./account-link/static
COPY services/agent-hub-service/account-link/integrity.json ./account-link/integrity.json

COPY services/agent-hub-service/agent-client/dist ./agent-client/dist
COPY services/agent-hub-service/agent-client/integrity.json ./agent-client/integrity.json
COPY services/agent-hub-service/agent-client/THIRD_PARTY_NOTICES.md ./agent-client/THIRD_PARTY_NOTICES.md
COPY services/agent-hub-service/agent-client/releases ./agent-client/releases
RUN python -c "from app.agent_client_assets import client_metadata; client_metadata('1.0.0'); client_metadata('1.0.1')"

USER appuser
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8080}\" --no-access-log"]
