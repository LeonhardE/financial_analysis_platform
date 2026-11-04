# Config service automatic deployment

`infra/gcp/cloudbuild.config.yaml` builds and publishes this service, then uses the existing
repository release guard to update its adopted Cloud Run service.

The deployment step pins the verified official Cloud CLI builder digest and invokes bundled Python
at `/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3`. The pinned image has no system
`python3` on PATH. Verify the replacement digest and interpreter layout before upgrading the image.
The existing deployment arguments, source/order/etag checks, runtime identity and IAM remain unchanged.
A complete successful main-trigger deployment establishes automatic release compatibility.
