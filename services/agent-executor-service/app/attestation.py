"""Only the internally validated complete Policy statement reaches the fixed TEE socket."""

import httpx

from .contracts import POLICY, closed, digest, require, safe

SOCKET = "/run/container_launcher/teeserver.sock"


class Attestation:
    def __init__(self, config, *, client=None):
        self.config = config
        self.client = client or httpx.Client(
            transport=httpx.HTTPTransport(uds=SOCKET),
            timeout=15,
            follow_redirects=False,
            trust_env=False,
        )

    def issue(self, statement):
        def issue():
            closed(
                statement,
                {
                    "profile",
                    "binding",
                    "challenge",
                    "operation",
                    "resourceBindings",
                    "bootId",
                    "releaseRecipientJwk",
                    "stateHead",
                    "authorizationEpoch",
                    "certificateDigest",
                    "authorizationMode",
                },
            )
            require(statement["profile"] == POLICY and statement["binding"] == self.config.binding)
            with self.client.stream(
                "POST",
                "http://localhost/v1/token",
                json={
                    "audience": self.config.public["workload"]["attestationAudience"],
                    "token_type": "OIDC",
                    "nonces": [digest(statement)],
                },
                follow_redirects=False,
            ) as response:
                require(response.status_code == 200)
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    require(len(raw) <= 32768)
            token = bytes(raw).decode("ascii").strip()
            require(len(token.split(".")) == 3 and all(token.split(".")))
            return token

        return safe(issue)

    def close(self):
        self.client.close()


class CreationAttestation:
    """Only used by the explicit reservation-bound creation command."""

    def __init__(self, issuer, *, client=None):
        from urllib.parse import urlsplit

        parsed = urlsplit(issuer)
        require(parsed.scheme == "https" and issuer == "https://" + str(parsed.hostname))
        self.audience = issuer + "/enrollment"
        self.client = client or httpx.Client(
            transport=httpx.HTTPTransport(uds=SOCKET),
            timeout=15,
            follow_redirects=False,
            trust_env=False,
        )

    def issue_creation(self, statement):
        def issue():
            from .contracts import PROFILE

            fields = {"profile", "action", "issuer", "permitFingerprint", "offerDigest"}
            require(type(statement) is dict and statement.get("action") in {"offer", "finalize"})
            if statement["action"] == "finalize":
                fields |= {
                    "finalizationFingerprint",
                    "binding",
                    "initialStateHead",
                    "wrappedKeyDigest",
                    "csrDigest",
                }
            closed(statement, fields)
            require(
                statement["profile"] == PROFILE
                and statement["issuer"] + "/enrollment" == self.audience
            )
            with self.client.stream(
                "POST",
                "http://localhost/v1/token",
                json={
                    "audience": self.audience,
                    "token_type": "OIDC",
                    "nonces": [digest(statement)],
                },
                follow_redirects=False,
            ) as response:
                require(response.status_code == 200)
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    require(len(body) <= 32768)
            token = bytes(body).decode("ascii").strip()
            require(len(token.split(".")) == 3 and all(token.split(".")))
            return {"statement": statement, "token": token}

        return safe(issue)

    def close(self):
        self.client.close()
