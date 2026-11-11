FROM python:3.13-slim-bookworm
# Keep the full attested environment reproducible across original-key restore.
ENV HOSTNAME=folioview-executor
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/common
ENV EXECUTOR_ENABLED=0
ENV EXECUTOR_CREATION_ENABLED=0
ENV EXECUTOR_NATIVE_ENABLED=0
WORKDIR /app
COPY services/agent-executor-service/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --only-binary=:all: --require-hashes --no-deps -r requirements.lock
COPY services/common/folioview_shared ./common/folioview_shared
RUN useradd --system --uid 10001 --create-home appuser
COPY services/agent-executor-service/app ./app
USER appuser
EXPOSE 8443
LABEL "tee.launch_policy.allow_cmd_override"="false"
LABEL "tee.launch_policy.allow_env_override"="EXECUTOR_ENABLED,EXECUTOR_CREATION_ENABLED,EXECUTOR_NATIVE_ENABLED,EXECUTOR_CONFIG_OBJECT,EXECUTOR_NATIVE_CONFIG_OBJECT,EXECUTOR_NATIVE_CONFIG_SHA256,EXECUTOR_ROOT_KEY_ID,EXECUTOR_DRAFT_OBJECT,EXECUTOR_PERMIT_OBJECT,EXECUTOR_ROOT_JWK_OBJECT,EXECUTOR_CREATION_WAIT_SECONDS"
LABEL "tee.launch_policy.allow_mount_destinations"=""
LABEL "tee.launch_policy.log_redirect"="never"
LABEL "tee.launch_policy.monitoring_memory_allow"="never"
LABEL "tee.launch_policy.nonroot_container"="nonrootonly"
CMD ["python", "-m", "app.main"]
