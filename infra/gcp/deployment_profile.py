"""Validate explicit deployment inputs and render offline, non-activating candidates.

This producer never obtains credentials, calls Google, invokes Terraform, changes
committed policy, or authorizes a deployment. Existing production consumers keep
using their reviewed configuration until separately migrated per target.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
MAX_PROFILE_BYTES = 131_072
MAX_TARGET_BYTES = 4_000
MAX_PLAN_AGE_SECONDS = 21_600
TARGET_SERVICES = {
    "repo": None,
    "market": "market-api",
    "user": "user-api",
    "config": "config-api",
    "web": "market-web",
    "portfolio": "portfolio-api",
    "agent-hub": "agent-hub-api",
}
TOP_FIELDS = {
    "schemaVersion",
    "profileId",
    "mode",
    "project",
    "region",
    "source",
    "artifactRepository",
    "state",
    "bootstrapStages",
    "firebase",
    "targets",
}
TARGET_FIELDS = {"enabled", "lifecycle", "origin", "image", "runtimeAccountId", "adoption"}
ADOPTION_FIELDS = {"serviceUid", "buildTriggerId", "planTriggerId", "applyTriggerId"}
TARGET_TOP_FIELDS = {
    "schemaVersion",
    "instanceId",
    "target",
    "project",
    "region",
    "source",
    "artifactRepository",
    "adoption",
    "inputs",
}
DEPLOYMENT_FIELDS = {
    "project_id",
    "region",
    "artifact_repository",
    "runtime_account_id",
    "creation_image",
    "existing_service_uid",
}
WEB_BUILD_FIELDS = {
    "_REGION",
    "_REPOSITORY",
    "_API_BASE_URL",
    "_USER_API_BASE_URL",
    "_CONFIG_API_BASE_URL",
    "_FIREBASE_API_KEY",
    "_FIREBASE_AUTH_DOMAIN",
    "_FIREBASE_PROJECT_ID",
    "_FIREBASE_APP_ID",
}
USER_HUB_TRUST_OPTIONS = {"enabled", "hubSubject"}
USER_HUB_TRUST_ENVIRONMENT_FIELDS = {
    "USER_SERVICE_AUDIENCE",
    "USER_DELEGATION_AUDIENCE",
    "USER_DELEGATION_ISSUER",
    "USER_TRUSTED_HUB_CALLERS",
}
USER_HUB_TRUST_FIELDS = {
    "schemaVersion",
    "instanceId",
    "target",
    "userDeploymentSha256",
    "hubDeploymentSha256",
    "hubSubject",
    "environment",
}
HUB_SUBJECT = re.compile(r"[1-9][0-9]{0,127}\Z")
WEB_OWNER_FLAGS = {"portfolio", "agentHub"}
WEB_OWNER_ENVIRONMENT_FIELDS = {
    "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID",
    "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED",
    "FOLIOVIEW_PORTFOLIO_ORIGIN",
    "FOLIOVIEW_PORTFOLIO_AUDIENCE",
    "FOLIOVIEW_HUB_OWNER_ENABLED",
    "FOLIOVIEW_HUB_ORIGIN",
}
WEB_OWNER_SERVER_FIELDS = {
    "schemaVersion",
    "instanceId",
    "target",
    "webDeploymentSha256",
    "environment",
}
WEB_OWNER_PUBLIC_FIELDS = {
    "schemaVersion",
    "instanceId",
    "target",
    "serverConfigurationSha256",
    "flags",
}
SLUG = re.compile(r"[a-z][a-z0-9-]{1,62}\Z")
PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
REGION = re.compile(r"[a-z]+(?:-[a-z0-9]+)+[0-9]\Z")
ACCOUNT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
DOMAIN = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\Z")


class ProfileError(ValueError):
    """Fixed diagnostics: never echo configuration, keys or parser exceptions."""

    def __init__(self):
        super().__init__("Invalid deployment profile or unsafe output destination.")


def require(condition):
    if not condition:
        raise ProfileError


def fields(value, expected):
    require(type(value) is dict and set(value) == set(expected))


def matches(pattern, value):
    require(type(value) is str and pattern.fullmatch(value) is not None)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def reject_constant(_value):
    raise ProfileError


def parse_profile(data):
    require(type(data) is bytes and 0 < len(data) <= MAX_PROFILE_BYTES)
    try:
        value = json.loads(
            data.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=reject_constant
        )
        return validate_profile(value)
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise ProfileError from None


def load_profile(path):
    try:
        path = Path(path)
        require(not path.is_symlink() and path.is_file())
        with path.open("rb") as source:
            return parse_profile(source.read(MAX_PROFILE_BYTES + 1))
    except (OSError, ValueError, TypeError):
        raise ProfileError from None


def hostname(value):
    matches(DOMAIN, value)
    require(".." not in value and "." in value and not value.endswith("."))


def origin(value):
    require(type(value) is str and len(value) <= 2048)
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == "https" and parsed.hostname is not None)
        require(not parsed.username and not parsed.password and not parsed.query)
        require(not parsed.fragment and not parsed.path and parsed.port is None)
        hostname(parsed.hostname)
        require(value == "https://" + parsed.hostname)
    except ValueError:
        raise ProfileError from None


def uuid(value):
    try:
        require(type(value) is str and str(UUID(value)) == value)
    except (ValueError, AttributeError):
        raise ProfileError from None


def validate_profile(value):
    """Closed structure and cross-field consistency, not live ownership attestation."""
    try:
        require(type(value) is dict)
        version = value.get("schemaVersion")
        require(type(version) is int and version in {1, 2, 3})
        fields(
            value,
            TOP_FIELDS
            | ({"webOwnerApis"} if version >= 2 else set())
            | ({"userHubTrust"} if version == 3 else set()),
        )
        matches(SLUG, value["profileId"])
        require(value["mode"] in {"adoption", "fresh_install"})
        fields(value["project"], {"id", "number"})
        project, number = value["project"]["id"], value["project"]["number"]
        matches(PROJECT, project)
        matches(re.compile(r"[1-9][0-9]{5,19}\Z"), number)
        matches(REGION, value["region"])
        region = value["region"]
        matches(SLUG, value["artifactRepository"])
        fields(value["state"], {"bootstrapBucket", "stateBucket", "planBucket"})
        require(
            value["state"]
            == {
                "bootstrapBucket": project + "-tf-bootstrap",
                "stateBucket": project + "-tfstate",
                "planBucket": project + "-tfplans",
            }
        )
        fields(value["source"], {"repositoryUrl", "repositoryResource"})
        source = value["source"]
        matches(
            re.compile(
                r"https://[a-z0-9.-]+/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.git\Z"
            ),
            source["repositoryUrl"],
        )
        parsed = urlsplit(source["repositoryUrl"])
        hostname(parsed.hostname)
        require(not parsed.username and not parsed.password)
        repository_pattern = re.compile(
            rf"projects/(?:{re.escape(project)}|{number})/locations/{region}/"
            r"connections/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/repositories/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z"
        )
        matches(repository_pattern, source["repositoryResource"])
        fields(value["bootstrapStages"], {"portfolio", "agent-hub"})
        require(
            all(
                stage in {"none", "execution", "service"}
                for stage in value["bootstrapStages"].values()
            )
        )
        if value["mode"] == "fresh_install":
            require(set(value["bootstrapStages"].values()) == {"none"})
        fields(value["firebase"], {"enabled", "apiKey", "authDomain", "appId"})
        firebase = value["firebase"]
        require(type(firebase["enabled"]) is bool)
        if firebase["enabled"]:
            matches(re.compile(r"AIza[A-Za-z0-9_-]{35}\Z"), firebase["apiKey"])
            hostname(firebase["authDomain"])
            if firebase["authDomain"].endswith(".firebaseapp.com"):
                require(firebase["authDomain"] == project + ".firebaseapp.com")
            matches(re.compile(rf"1:{number}:web:[a-f0-9]{{16,64}}\Z"), firebase["appId"])
        else:
            require(all(firebase[key] == "" for key in ("apiKey", "authDomain", "appId")))
        fields(value["targets"], TARGET_SERVICES)
        seen_origins, seen_anchors, seen_runtime_accounts = set(), set(), set()
        for name, target in value["targets"].items():
            fields(target, TARGET_FIELDS)
            require(type(target["enabled"]) is bool)
            require(target["lifecycle"] in {"adopt", "create"})
            if value["mode"] == "fresh_install":
                require(target["lifecycle"] == "create")
            if target["lifecycle"] == "create":
                require(target["enabled"] is False and target["adoption"] is None)
            else:
                anchors = target["adoption"]
                fields(anchors, ADOPTION_FIELDS)
                for key, identifier in anchors.items():
                    if name == "repo" and key in {"serviceUid", "buildTriggerId"}:
                        require(identifier is None)
                        continue
                    uuid(identifier)
                    require(identifier not in seen_anchors)
                    seen_anchors.add(identifier)
            if name == "repo":
                require(all(target[key] is None for key in ("origin", "image", "runtimeAccountId")))
                continue
            matches(ACCOUNT, target["runtimeAccountId"])
            require(target["runtimeAccountId"] not in seen_runtime_accounts)
            seen_runtime_accounts.add(target["runtimeAccountId"])
            if name in value["bootstrapStages"]:
                stage = value["bootstrapStages"][name]
                require(
                    stage == "service"
                    if target["lifecycle"] == "adopt"
                    else stage in {"none", "execution"}
                )
            address = target["origin"]
            if address is not None:
                origin(address)
                require(address not in seen_origins)
                seen_origins.add(address)
                # Check project/region when using the canonical numbered Run URL.
                if re.search(r"-[0-9]+\.[a-z0-9-]+\.run\.app\Z", address):
                    require(address == f"https://{TARGET_SERVICES[name]}-{number}.{region}.run.app")
            image = target["image"]
            if image is not None:
                matches(
                    re.compile(
                        rf"{region}-docker\.pkg\.dev/{project}/{value['artifactRepository']}/"
                        rf"{TARGET_SERVICES[name]}@sha256:[a-f0-9]{{64}}\Z"
                    ),
                    image,
                )
            if target["lifecycle"] == "adopt":
                require(address is not None and image is not None)
        if firebase["enabled"]:
            require(value["targets"]["web"]["origin"] is not None)
        if version >= 2:
            flags = value["webOwnerApis"]
            fields(flags, WEB_OWNER_FLAGS)
            require(all(type(flag) is bool for flag in flags.values()))
            for flag, target_name in (("portfolio", "portfolio"), ("agentHub", "agent-hub")):
                if flags[flag]:
                    require(firebase["enabled"])
                    require(value["targets"]["web"]["lifecycle"] == "adopt")
                    upstream = value["targets"][target_name]
                    require(upstream["lifecycle"] == "adopt" and upstream["origin"] is not None)
                    if target_name == "portfolio":
                        # This first consumer contract supports the numbered Run URL
                        # as both origin and default audience, not custom audiences.
                        require(
                            upstream["origin"]
                            == f"https://{TARGET_SERVICES[target_name]}-{number}.{region}.run.app"
                        )
        if version == 3:
            trust = value["userHubTrust"]
            fields(trust, USER_HUB_TRUST_OPTIONS)
            require(type(trust["enabled"]) is bool)
            if trust["enabled"]:
                matches(HUB_SUBJECT, trust["hubSubject"])
                for name in ("user", "agent-hub"):
                    selected = value["targets"][name]
                    require(selected["lifecycle"] == "adopt")
                    # V1 uses canonical Run origins as issuer/audience. A custom
                    # audience or issuer needs a separately reviewed contract.
                    require(
                        selected["origin"]
                        == f"https://{TARGET_SERVICES[name]}-{number}.{region}.run.app"
                    )
            else:
                require(trust["hubSubject"] is None)
        # Canonical serialization rejects invalid Unicode and snapshots mutable callers.
        return json.loads(canonical(value))
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        raise ProfileError from None


def input_fields(target):
    if target == "repo":
        return {"project_id"}
    result = set(DEPLOYMENT_FIELDS)
    if target in {"market", "config", "portfolio", "user"}:
        result.add("web_origin")
    if target == "user":
        result.add("market_origin")
    return result


def validate_instance_origin(address, service, number, region):
    origin(address)
    if re.search(r"-[0-9]+\.[a-z0-9-]+\.run\.app\Z", address):
        require(address == f"https://{service}-{number}.{region}.run.app")


def validate_target(value):
    """Closed per-target transport, not approval or independent inventory."""
    try:
        require(type(value) is dict)
        target = value.get("target")
        require(type(target) is str and target in TARGET_SERVICES)
        has_user_trust = "userHubTrust" in value
        require(not has_user_trust or target == "user")
        fields(
            value,
            TARGET_TOP_FIELDS
            | ({"build"} if target == "web" else set())
            | ({"userHubTrust"} if has_user_trust else set()),
        )
        require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
        matches(SLUG, value["instanceId"])
        fields(value["project"], {"id", "number"})
        project, number = value["project"]["id"], value["project"]["number"]
        matches(PROJECT, project)
        matches(re.compile(r"[1-9][0-9]{5,19}\Z"), number)
        region = value["region"]
        matches(REGION, region)
        matches(SLUG, value["artifactRepository"])
        fields(value["source"], {"repositoryUrl", "repositoryResource"})
        source = value["source"]
        matches(
            re.compile(
                r"https://[a-z0-9.-]+/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.git\Z"
            ),
            source["repositoryUrl"],
        )
        hostname(urlsplit(source["repositoryUrl"]).hostname)
        matches(
            re.compile(
                rf"projects/(?:{re.escape(project)}|{number})/locations/{region}/"
                r"connections/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/repositories/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z"
            ),
            source["repositoryResource"],
        )
        anchors = value["adoption"]
        fields(anchors, ADOPTION_FIELDS)
        seen = set()
        for name, identifier in anchors.items():
            if target == "repo" and name in {"serviceUid", "buildTriggerId"}:
                require(identifier is None)
                continue
            uuid(identifier)
            require(identifier not in seen)
            seen.add(identifier)
        inputs = value["inputs"]
        fields(inputs, input_fields(target))
        require(inputs["project_id"] == project)
        if target != "repo":
            require(inputs["region"] == region)
            require(inputs["artifact_repository"] == value["artifactRepository"])
            matches(ACCOUNT, inputs["runtime_account_id"])
            require(inputs["existing_service_uid"] == anchors["serviceUid"])
            matches(
                re.compile(
                    rf"{region}-docker\.pkg\.dev/{project}/{value['artifactRepository']}/"
                    rf"{TARGET_SERVICES[target]}@sha256:[a-f0-9]{{64}}\Z"
                ),
                inputs["creation_image"],
            )
        for name, service in (("web_origin", "market-web"), ("market_origin", "market-api")):
            if name in inputs:
                validate_instance_origin(inputs[name], service, number, region)
        if "market_origin" in inputs:
            require(inputs["market_origin"] != inputs["web_origin"])
        if target == "web":
            build = value["build"]
            fields(build, WEB_BUILD_FIELDS)
            require(build["_REGION"] == region)
            require(build["_REPOSITORY"] == value["artifactRepository"])
            origins = []
            for name, service in (
                ("_API_BASE_URL", "market-api"),
                ("_USER_API_BASE_URL", "user-api"),
                ("_CONFIG_API_BASE_URL", "config-api"),
            ):
                require(type(build[name]) is str)
                if build[name]:
                    validate_instance_origin(build[name], service, number, region)
                    origins.append(build[name])
            require(len(set(origins)) == len(origins))
            if build["_FIREBASE_PROJECT_ID"] == "":
                require(
                    all(
                        build[name] == ""
                        for name in (
                            "_FIREBASE_API_KEY",
                            "_FIREBASE_AUTH_DOMAIN",
                            "_FIREBASE_APP_ID",
                        )
                    )
                )
            else:
                require(build["_FIREBASE_PROJECT_ID"] == project)
                matches(re.compile(r"AIza[A-Za-z0-9_-]{35}\Z"), build["_FIREBASE_API_KEY"])
                hostname(build["_FIREBASE_AUTH_DOMAIN"])
                if build["_FIREBASE_AUTH_DOMAIN"].endswith(".firebaseapp.com"):
                    require(build["_FIREBASE_AUTH_DOMAIN"] == project + ".firebaseapp.com")
                matches(
                    re.compile(rf"1:{number}:web:[a-f0-9]{{16,64}}\Z"), build["_FIREBASE_APP_ID"]
                )
        if has_user_trust:
            trust = value["userHubTrust"]
            fields(trust, {"configuration", "hubDeployment"})
            base = {name: item for name, item in value.items() if name != "userHubTrust"}
            configuration = trust["configuration"]
            require(type(configuration) is dict)
            require((configuration.get("hubSubject") is None) == (trust["hubDeployment"] is None))
            validate_user_hub_trust(configuration, base, trust["hubDeployment"])
        require(len(canonical(value)) <= MAX_TARGET_BYTES)
    except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
        raise ProfileError from None
    return value


def parse_target(data):
    """Require exactly canonical bytes as stored in a managed substitution."""
    require(type(data) is bytes and 0 < len(data) <= MAX_TARGET_BYTES)
    try:
        value = json.loads(
            data.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=reject_constant
        )
        validate_target(value)
        require(canonical(value) == data)
        return value
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise ProfileError from None


def terraform_inputs(instance):
    """The only variable file body; no arbitrary Terraform variables."""
    value = parse_target(canonical(instance))
    result = {"deployment": dict(value["inputs"])}
    if "userHubTrust" in value:
        result["hub_trust"] = dict(value["userHubTrust"]["configuration"]["environment"])
    return result


def compile_target(profile, target):
    """Project operator input without coupling unrelated target settings."""
    profile = validate_profile(profile)
    require(type(target) is str and target in TARGET_SERVICES)
    selected = profile["targets"][target]
    require(selected["lifecycle"] == "adopt")
    project = profile["project"]["id"]
    inputs = {"project_id": project}
    if target != "repo":
        inputs.update(
            region=profile["region"],
            artifact_repository=profile["artifactRepository"],
            runtime_account_id=selected["runtimeAccountId"],
            creation_image=selected["image"],
            existing_service_uid=selected["adoption"]["serviceUid"],
        )
    if "web_origin" in input_fields(target):
        inputs["web_origin"] = profile["targets"]["web"]["origin"]
    if target == "user":
        inputs["market_origin"] = profile["targets"]["market"]["origin"]
    result = {
        "schemaVersion": 1,
        "instanceId": profile["profileId"],
        "target": target,
        "project": dict(profile["project"]),
        "region": profile["region"],
        "source": dict(profile["source"]),
        "artifactRepository": profile["artifactRepository"],
        "adoption": dict(selected["adoption"]),
        "inputs": inputs,
    }
    if target == "web":
        firebase = profile["firebase"]
        result["build"] = {
            "_REGION": profile["region"],
            "_REPOSITORY": profile["artifactRepository"],
            "_API_BASE_URL": profile["targets"]["market"]["origin"] or "",
            "_USER_API_BASE_URL": profile["targets"]["user"]["origin"] or "",
            "_CONFIG_API_BASE_URL": profile["targets"]["config"]["origin"] or "",
            "_FIREBASE_API_KEY": firebase["apiKey"],
            "_FIREBASE_AUTH_DOMAIN": firebase["authDomain"],
            "_FIREBASE_PROJECT_ID": project if firebase["enabled"] else "",
            "_FIREBASE_APP_ID": firebase["appId"],
        }
    return parse_target(canonical(result))


def compile_artifacts(profile, target):
    instance = compile_target(profile, target)
    artifacts = {
        "deployment-config.candidate.json": instance,
        "terraform-inputs.candidate.json": terraform_inputs(instance),
        "trigger-substitutions.candidate.json": {
            "_DEPLOYMENT_CONFIG": canonical(instance).decode("ascii"),
            "_DEPLOYMENT_SHA256": digest(instance),
        },
    }
    return {
        **artifacts,
        "manifest.json": {
            "schemaVersion": 1,
            "purpose": "offline_target_candidate",
            "approval": "not_requested",
            "productionActivation": False,
            "instanceId": instance["instanceId"],
            "target": target,
            "deploymentSha256": digest(instance),
            "terraformInputsSha256": digest(terraform_inputs(instance)),
            "filesSha256": {
                name: hashlib.sha256(canonical(value) + b"\n").hexdigest()
                for name, value in artifacts.items()
            },
        },
    }


def validate_web_owner_server(value, instance):
    """Validate a separate future-consumer contract, never Terraform inputs."""
    try:
        instance = parse_target(canonical(instance))
        require(instance["target"] == "web")
        fields(value, WEB_OWNER_SERVER_FIELDS)
        require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
        require(value["target"] == "web" and value["instanceId"] == instance["instanceId"])
        require(value["webDeploymentSha256"] == digest(instance))
        environment = value["environment"]
        fields(environment, WEB_OWNER_ENVIRONMENT_FIELDS)
        require(all(type(item) is str for item in environment.values()))
        portfolio_enabled = environment["FOLIOVIEW_PORTFOLIO_OWNER_ENABLED"]
        hub_enabled = environment["FOLIOVIEW_HUB_OWNER_ENABLED"]
        require(portfolio_enabled in {"true", "false"} and hub_enabled in {"true", "false"})
        enabled = "true" in {portfolio_enabled, hub_enabled}
        project = instance["project"]["id"]
        require(environment["FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID"] == (project if enabled else ""))
        if enabled:
            require(instance["build"]["_FIREBASE_PROJECT_ID"] == project)
        portfolio = environment["FOLIOVIEW_PORTFOLIO_ORIGIN"]
        audience = environment["FOLIOVIEW_PORTFOLIO_AUDIENCE"]
        if portfolio_enabled == "true":
            number, region = instance["project"]["number"], instance["region"]
            require(portfolio == f"https://portfolio-api-{number}.{region}.run.app")
            require(audience == portfolio)
        else:
            require(portfolio == audience == "")
        hub = environment["FOLIOVIEW_HUB_ORIGIN"]
        if hub_enabled == "true":
            validate_instance_origin(
                hub, "agent-hub-api", instance["project"]["number"], instance["region"]
            )
            require(hub != portfolio)
            require(
                hub
                not in {
                    instance["build"][name]
                    for name in ("_API_BASE_URL", "_USER_API_BASE_URL", "_CONFIG_API_BASE_URL")
                }
            )
        else:
            require(hub == "")
        require(len(canonical(value)) <= MAX_TARGET_BYTES)
    except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
        raise ProfileError from None
    return value


def parse_web_owner_document(data):
    """Bounded canonical JSON shared by the separate owner configuration files."""
    require(type(data) is bytes and 0 < len(data) <= MAX_TARGET_BYTES)
    try:
        value = json.loads(
            data.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=reject_constant
        )
        require(canonical(value) == data)
        return value
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise ProfileError from None


def parse_web_owner_server(data, *, instance, expected_sha256):
    """Consumers must supply the independently trusted configuration hash pin."""
    value = parse_web_owner_document(data)
    validate_web_owner_server(value, instance)
    matches(re.compile(r"[a-f0-9]{64}\Z"), expected_sha256)
    require(digest(value) == expected_sha256)
    return value


def parse_web_owner_public(data, *, server, instance, expected_server_sha256):
    """Public flags must match the validated, pinned server configuration."""
    try:
        server = parse_web_owner_server(
            canonical(server), instance=instance, expected_sha256=expected_server_sha256
        )
        value = parse_web_owner_document(data)
        fields(value, WEB_OWNER_PUBLIC_FIELDS)
        require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
        require(value["instanceId"] == server["instanceId"] and value["target"] == "web")
        require(value["serverConfigurationSha256"] == digest(server))
        fields(value["flags"], WEB_OWNER_FLAGS)
        require(all(type(flag) is bool for flag in value["flags"].values()))
        require(
            value["flags"]
            == {
                "portfolio": server["environment"]["FOLIOVIEW_PORTFOLIO_OWNER_ENABLED"] == "true",
                "agentHub": server["environment"]["FOLIOVIEW_HUB_OWNER_ENABLED"] == "true",
            }
        )
    except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
        raise ProfileError from None
    return value


def compile_web_owner_artifacts(profile):
    """Explicit offline output only; existing compile/render consumers are unchanged."""
    profile = validate_profile(profile)
    instance = compile_target(profile, "web")
    flags = profile.get("webOwnerApis", {"portfolio": False, "agentHub": False})
    portfolio = profile["targets"]["portfolio"]["origin"] if flags["portfolio"] else ""
    hub = profile["targets"]["agent-hub"]["origin"] if flags["agentHub"] else ""
    server = {
        "schemaVersion": 1,
        "instanceId": instance["instanceId"],
        "target": "web",
        "webDeploymentSha256": digest(instance),
        "environment": {
            "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID": profile["project"]["id"]
            if any(flags.values())
            else "",
            "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED": str(flags["portfolio"]).lower(),
            "FOLIOVIEW_PORTFOLIO_ORIGIN": portfolio,
            "FOLIOVIEW_PORTFOLIO_AUDIENCE": portfolio,
            "FOLIOVIEW_HUB_OWNER_ENABLED": str(flags["agentHub"]).lower(),
            "FOLIOVIEW_HUB_ORIGIN": hub,
        },
    }
    parse_web_owner_server(canonical(server), instance=instance, expected_sha256=digest(server))
    public = {
        "schemaVersion": 1,
        "instanceId": instance["instanceId"],
        "target": "web",
        "serverConfigurationSha256": digest(server),
        "flags": dict(flags),
    }
    parse_web_owner_public(
        canonical(public), server=server, instance=instance, expected_server_sha256=digest(server)
    )
    artifacts = {
        "web-owner-server.candidate.json": server,
        "web-owner-public.candidate.json": public,
    }
    return {
        **artifacts,
        "manifest.json": {
            "schemaVersion": 1,
            "purpose": "offline_web_owner_candidate",
            "approval": "not_requested",
            "productionActivation": False,
            "instanceId": instance["instanceId"],
            "target": "web",
            "profileSha256": digest(profile),
            "webDeploymentSha256": digest(instance),
            "serverConfigurationSha256": digest(server),
            "filesSha256": {
                name: hashlib.sha256(canonical(value) + b"\n").hexdigest()
                for name, value in artifacts.items()
            },
        },
    }


def validate_user_hub_trust(value, instance, hub_instance=None):
    """Closed future User-consumer document, never an active Terraform input."""
    try:
        require(type(instance) is dict and instance.get("target") == "user")
        require("userHubTrust" not in instance)
        instance = parse_target(canonical(instance))
        fields(value, USER_HUB_TRUST_FIELDS)
        require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
        require(value["target"] == "user" and value["instanceId"] == instance["instanceId"])
        require(value["userDeploymentSha256"] == digest(instance))
        environment = value["environment"]
        fields(environment, USER_HUB_TRUST_ENVIRONMENT_FIELDS)
        require(all(type(item) is str for item in environment.values()))
        subject = value["hubSubject"]
        if subject is None:
            require(value["hubDeploymentSha256"] is None)
            require(all(item == "" for item in environment.values()))
        else:
            matches(HUB_SUBJECT, subject)
            require(type(hub_instance) is dict and hub_instance.get("target") == "agent-hub")
            hub = parse_target(canonical(hub_instance))
            for name in ("instanceId", "project", "region", "source", "artifactRepository"):
                require(hub[name] == instance[name])
            require(hub["adoption"]["serviceUid"] != instance["adoption"]["serviceUid"])
            require(hub["inputs"]["runtime_account_id"] != instance["inputs"]["runtime_account_id"])
            require(value["hubDeploymentSha256"] == digest(hub))
            number, region = instance["project"]["number"], instance["region"]
            audience = f"https://user-api-{number}.{region}.run.app"
            issuer = f"https://agent-hub-api-{number}.{region}.run.app"
            email = (
                hub["inputs"]["runtime_account_id"]
                + "@"
                + instance["project"]["id"]
                + ".iam.gserviceaccount.com"
            )
            require(
                environment
                == {
                    "USER_SERVICE_AUDIENCE": audience,
                    "USER_DELEGATION_AUDIENCE": audience + "/internal/v2",
                    "USER_DELEGATION_ISSUER": issuer,
                    "USER_TRUSTED_HUB_CALLERS": canonical({subject: email}).decode("ascii"),
                }
            )
        require(len(canonical(value)) <= MAX_TARGET_BYTES)
    except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
        raise ProfileError from None
    return value


def parse_user_hub_trust(data, *, instance, expected_sha256, hub_instance=None):
    """Require canonical bytes, selected target anchors and an independently trusted hash."""
    value = parse_web_owner_document(data)
    validate_user_hub_trust(value, instance, hub_instance)
    matches(re.compile(r"[a-f0-9]{64}\Z"), expected_sha256)
    require(digest(value) == expected_sha256)
    return value


def compile_user_hub_trust_artifacts(profile):
    """Explicit offline trust candidate; old compile/render paths remain non-consuming."""
    profile = validate_profile(profile)
    instance = compile_target(profile, "user")
    trust = profile.get("userHubTrust", {"enabled": False, "hubSubject": None})
    hub = compile_target(profile, "agent-hub") if trust["enabled"] else None
    document = {
        "schemaVersion": 1,
        "instanceId": instance["instanceId"],
        "target": "user",
        "userDeploymentSha256": digest(instance),
        "hubDeploymentSha256": digest(hub) if hub else None,
        "hubSubject": trust["hubSubject"],
        "environment": dict.fromkeys(sorted(USER_HUB_TRUST_ENVIRONMENT_FIELDS), ""),
    }
    if hub:
        number, region = instance["project"]["number"], instance["region"]
        audience = f"https://user-api-{number}.{region}.run.app"
        email = (
            hub["inputs"]["runtime_account_id"]
            + "@"
            + instance["project"]["id"]
            + ".iam.gserviceaccount.com"
        )
        document["environment"] = {
            "USER_SERVICE_AUDIENCE": audience,
            "USER_DELEGATION_AUDIENCE": audience + "/internal/v2",
            "USER_DELEGATION_ISSUER": f"https://agent-hub-api-{number}.{region}.run.app",
            "USER_TRUSTED_HUB_CALLERS": canonical({trust["hubSubject"]: email}).decode("ascii"),
        }
    parse_user_hub_trust(
        canonical(document),
        instance=instance,
        hub_instance=hub,
        expected_sha256=digest(document),
    )
    # The explicit command also prepares the full managed projection. Legacy
    # compile/render still omit this opt-in, self-contained User-only extension.
    extended = parse_target(
        canonical(
            {
                **instance,
                "userHubTrust": {"configuration": document, "hubDeployment": hub},
            }
        )
    )
    inputs = terraform_inputs(extended)
    artifacts = {
        "user-hub-trust.candidate.json": document,
        "deployment-config.candidate.json": extended,
        "terraform-inputs.candidate.json": inputs,
        "trigger-substitutions.candidate.json": {
            "_DEPLOYMENT_CONFIG": canonical(extended).decode("ascii"),
            "_DEPLOYMENT_SHA256": digest(extended),
        },
    }
    return {
        **artifacts,
        "manifest.json": {
            "schemaVersion": 1,
            "purpose": "offline_user_hub_trust_candidate",
            "approval": "not_requested",
            "productionActivation": False,
            "instanceId": instance["instanceId"],
            "target": "user",
            "profileSha256": digest(profile),
            "userDeploymentSha256": digest(instance),
            "hubDeploymentSha256": digest(hub) if hub else None,
            "trustConfigurationSha256": digest(document),
            "deploymentSha256": digest(extended),
            "terraformInputsSha256": digest(inputs),
            "filesSha256": {
                name: hashlib.sha256(canonical(value) + b"\n").hexdigest()
                for name, value in artifacts.items()
            },
        },
    }


def render(profile, *, root=ROOT):
    profile = validate_profile(profile)
    project, number = profile["project"]["id"], profile["project"]["number"]
    toolchain = json.loads((root / "infra/gcp/terraform/toolchain.json").read_text())
    targets = {}
    inventory = {}
    for name, target in profile["targets"].items():
        prefix = "fa-infra" if name == "repo" else "fa-infra-" + name
        targets[name] = {
            "enabled": target["enabled"],
            "directory": f"infra/gcp/terraform/envs/prod/{name}",
            "state_bucket": profile["state"]["stateBucket"]
            if name == "repo"
            else f"{project}-tfstate-{name}",
            "state_prefix": "prod/" + name,
            "plan_trigger": "terraform-plan-" + name,
            "apply_trigger": "terraform-apply-" + name,
            "plan_service_account": prefix + f"-plan@{project}.iam.gserviceaccount.com",
            "apply_service_account": prefix + f"-apply@{project}.iam.gserviceaccount.com",
            "configuration_controllers": []
            if name == "repo"
            else [f"module.{name.replace('-', '_')}.terraform_data.configuration"],
        }
        inventory[name] = {
            **target,
            "service": TARGET_SERVICES[name],
            "runtimeServiceAccount": None
            if name == "repo"
            else f"{target['runtimeAccountId']}@{project}.iam.gserviceaccount.com",
        }
    pipeline = {
        "schema_version": 2,
        "project_id": project,
        "project_number": number,
        "region": profile["region"],
        "repository_url": profile["source"]["repositoryUrl"],
        "terraform_version": toolchain["terraform_version"],
        "state_bucket": profile["state"]["stateBucket"],
        "plan_bucket": profile["state"]["planBucket"],
        "max_plan_age_seconds": MAX_PLAN_AGE_SECONDS,
        "targets": targets,
    }
    firebase = profile["firebase"]
    artifacts = {
        "pipeline.candidate.json": pipeline,
        "bootstrap-inputs.candidate.json": {
            "project_id": project,
            "region": profile["region"],
            "repository_id": profile["source"]["repositoryResource"],
            "portfolio_provisioning_stage": profile["bootstrapStages"]["portfolio"],
            "agent_hub_provisioning_stage": profile["bootstrapStages"]["agent-hub"],
            "deployment_configs": {
                name: canonical(compile_target(profile, name)).decode("ascii")
                for name, target in profile["targets"].items()
                if target["lifecycle"] == "adopt"
            },
        },
        "backends.candidate.json": {
            "bootstrap": {"bucket": profile["state"]["bootstrapBucket"], "prefix": "bootstrap"},
            **{
                name: {"bucket": entry["state_bucket"], "prefix": entry["state_prefix"]}
                for name, entry in targets.items()
            },
        },
        "web-substitutions.candidate.json": {
            "_REGION": profile["region"],
            "_REPOSITORY": profile["artifactRepository"],
            "_API_BASE_URL": profile["targets"]["market"]["origin"] or "",
            "_USER_API_BASE_URL": profile["targets"]["user"]["origin"] or "",
            "_CONFIG_API_BASE_URL": profile["targets"]["config"]["origin"] or "",
            "_FIREBASE_API_KEY": firebase["apiKey"],
            "_FIREBASE_AUTH_DOMAIN": firebase["authDomain"],
            "_FIREBASE_PROJECT_ID": project if firebase["enabled"] else "",
            "_FIREBASE_APP_ID": firebase["appId"],
        },
        "inventory.candidate.json": {
            "schemaVersion": 1,
            "profileId": profile["profileId"],
            "mode": profile["mode"],
            "source": profile["source"],
            "targets": inventory,
        },
    }
    manifest = {
        "schemaVersion": 1,
        "purpose": "offline_candidate",
        "approval": "not_requested",
        "productionActivation": False,
        "profileId": profile["profileId"],
        "profileSha256": digest(profile),
        "sourceSha256": digest(profile["source"]),
        "targetSha256": {
            name: digest({"profileSha256": digest(profile), "target": name, "input": target})
            for name, target in profile["targets"].items()
        },
        "filesSha256": {
            name: hashlib.sha256(canonical(value) + b"\n").hexdigest()
            for name, value in artifacts.items()
        },
    }
    return {**artifacts, "manifest.json": manifest}


def write_candidates(artifacts, destination):
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink())
    # Resolve directory aliases (including system temporary directories), while
    # refusing an existing/symlink destination and writing only new fixed filenames.
    destination = destination.resolve()
    created = False
    try:
        destination.mkdir(mode=0o700)
        created = True
        destination.chmod(0o700)
        for name, value in artifacts.items():
            require(Path(name).name == name)
            with (destination / name).open("xb") as output:
                os.chmod(output.name, 0o600)
                output.write(canonical(value) + b"\n")
    except (OSError, ProfileError):
        if created:
            shutil.rmtree(destination)
        raise ProfileError from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("validate", "render", "compile", "compile-web-owner", "compile-user-hub-trust"),
    )
    parser.add_argument("--profile", required=True)
    parser.add_argument("--output-dir")
    parser.add_argument("--target")
    args = parser.parse_args()
    try:
        require(
            (args.action in {"render", "compile", "compile-web-owner", "compile-user-hub-trust"})
            == (args.output_dir is not None)
        )
        require((args.action == "compile") == (args.target is not None))
        profile = load_profile(args.profile)
        if args.action == "compile-user-hub-trust":
            artifacts = compile_user_hub_trust_artifacts(profile)
        elif args.action == "compile-web-owner":
            artifacts = compile_web_owner_artifacts(profile)
        else:
            artifacts = (
                compile_artifacts(profile, args.target)
                if args.action == "compile"
                else render(profile)
            )
        if args.action in {"render", "compile", "compile-web-owner", "compile-user-hub-trust"}:
            write_candidates(artifacts, args.output_dir)
        # Hashes identify selected input; they are not source-provenance or approval proof.
        print(json.dumps(artifacts["manifest.json"], sort_keys=True))
        return 0
    except (ProfileError, OSError, ValueError, TypeError):
        print("Deployment profile rejected; configuration values withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
