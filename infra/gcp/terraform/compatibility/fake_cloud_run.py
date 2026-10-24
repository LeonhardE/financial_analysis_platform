"""Bounded localhost Cloud Run wire fixture; this is not a GCP emulator.

The fixture models named-revision immutability, desired versus observed traffic,
ETags, and the v2 update mask fields exercised by the compatibility check. It
never opens an outbound connection or accepts a non-fixture resource name.
"""

import copy
import json
import threading
from contextlib import AbstractContextManager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PROJECT = "folioview-compatibility"
REGION = "northamerica-northeast2"
SERVICE = "compatibility"
RESOURCE = f"projects/{PROJECT}/locations/{REGION}/services/{SERVICE}"
TOKEN = "offline-fixture-token"


class FakeCloudRun(AbstractContextManager):
    def __init__(self):
        self.service = None
        self.revisions = {}
        self.requests = []
        self.sequence = 0
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def handle_request(self):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length > 1024 * 1024:
                        return self.reply({"error": {"message": "Oversized fixture request"}}, 413)
                    body = json.loads(self.rfile.read(length)) if length else None
                    if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                        return self.reply({"error": {"message": "Fixture token required"}}, 401)
                    status, response = fixture.request(self.command, self.path, body)
                    self.reply(response, status)
                except (TypeError, ValueError, KeyError) as error:
                    self.reply({"error": {"message": str(error)}}, 400)

            def reply(self, response, status):
                data = json.dumps(response).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = handle_request
            do_POST = handle_request
            do_PATCH = handle_request

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}/v2/"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, body):
        """Apply only the modeled v2 routes and record every request body."""
        self.requests.append({"method": method, "path": path, "body": copy.deepcopy(body)})
        parsed = urlsplit(path)
        collection = f"/v2/projects/{PROJECT}/locations/{REGION}/services"
        resource = f"/v2/{RESOURCE}"
        if method == "GET" and parsed.path == resource and self.service:
            return 200, copy.deepcopy(self.service)
        if method == "POST" and parsed.path == collection:
            if parse_qs(parsed.query).get("serviceId") != [SERVICE] or self.service:
                return self.error(409, "Invalid or duplicate fixture create")
            desired = copy.deepcopy(body)
            desired["name"] = RESOURCE
        elif method == "PATCH" and parsed.path == resource and self.service:
            if body.get("etag") and body["etag"] != self.service["etag"]:
                return self.error(409, "Fixture etag conflict")
            desired = copy.deepcopy(self.service)
            mask = parse_qs(parsed.query).get("updateMask")
            fields = mask[0].split(",") if mask else body.keys()
            for key in fields:
                if key not in (
                    "template",
                    "traffic",
                    "annotations",
                    "labels",
                    "ingress",
                ):
                    continue
                if key in body:
                    desired[key] = copy.deepcopy(body[key])
        else:
            return self.error(404, "Only the synthetic fixture resource is supported")

        template = desired["template"]
        revision = template.get("revision")
        content = copy.deepcopy(template)
        content.pop("revision", None)
        if revision and revision in self.revisions and self.revisions[revision] != content:
            return self.error(409, "Named revision already exists with different configuration")
        template_changed = self.service is None or template != self.service["template"]
        if template_changed:
            self.sequence += 1
            latest = revision or f"{SERVICE}-auto-{self.sequence:05d}"
            self.revisions[latest] = content
        else:
            latest = self.service["latestCreatedRevision"].rsplit("/", 1)[-1]
        generation = int(self.service["generation"]) + 1 if self.service else 1
        desired.update(
            generation=str(generation),
            observedGeneration=str(generation),
            latestCreatedRevision=f"{RESOURCE}/revisions/{latest}",
            latestReadyRevision=f"{RESOURCE}/revisions/{latest}",
            terminalCondition={"type": "Ready", "state": "CONDITION_SUCCEEDED"},
            reconciling=False,
            etag=f"fixture-{generation}",
            uid="fixture-service-uid",
            uri="https://fixture.example.invalid",
        )
        desired["trafficStatuses"] = [
            dict(
                target,
                revision=(
                    latest
                    if target["type"] == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
                    else target["revision"]
                ),
            )
            for target in desired.get("traffic", [])
        ]
        self.service = desired
        return 200, {
            "name": f"projects/{PROJECT}/locations/{REGION}/operations/offline-operation",
            "done": True,
            "response": copy.deepcopy(desired),
        }

    @staticmethod
    def error(code, message):
        return code, {"error": {"code": code, "message": message}}
