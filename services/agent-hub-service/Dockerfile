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
COPY services/agent-hub-service/helper/dist ./helper/dist
COPY services/agent-hub-service/helper/integrity.json ./helper/integrity.json
COPY services/agent-hub-service/helper/protocol.json ./helper/protocol.json
COPY services/agent-hub-service/helper/THIRD_PARTY_NOTICES.md ./helper/THIRD_PARTY_NOTICES.md

USER appuser
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8080}\" --no-access-log"]
