FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/common
ENV EXECUTOR_ENABLED=0
ENV EXECUTOR_CREATION_ENABLED=0
WORKDIR /app
COPY services/agent-executor-service/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --only-binary=:all: --require-hashes --no-deps -r requirements.lock
COPY services/common/folioview_shared ./common/folioview_shared
RUN useradd --system --uid 10001 --create-home appuser
COPY services/agent-executor-service/app ./app
USER appuser
EXPOSE 8443
CMD ["python", "-m", "app.main"]
