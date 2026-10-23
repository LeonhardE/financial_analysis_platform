"""Verify Firebase Google sign-in tokens without changing public market access."""

import os
from threading import Lock
from typing import Annotated

import firebase_admin
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth, exceptions
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel
from requests.exceptions import RequestException

_APP_NAME = "financial-analysis-api"
_app_lock = Lock()
_bearer = HTTPBearer(auto_error=False)
_NO_STORE = {"Cache-Control": "no-store"}


class CurrentUser(BaseModel):
    """Only identity fields verified by the server are returned to the browser."""

    uid: str
    email: str | None
    displayName: str | None
    photoURL: str | None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="A valid Google sign-in is required",
        headers={**_NO_STORE, "WWW-Authenticate": "Bearer"},
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="Sign-in is temporarily unavailable",
        headers=_NO_STORE,
    )


def _get_firebase_app() -> firebase_admin.App:
    """Load ADC only when auth is used; unconfigured public pages remain available."""
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    if not project_id:
        raise _unavailable()

    # The Auth emulator accepts unsigned tokens. Never enable it in Cloud Run.
    if os.getenv("FIREBASE_AUTH_EMULATOR_HOST") and "K_SERVICE" in os.environ:
        raise _unavailable()

    try:
        with _app_lock:
            try:
                app = firebase_admin.get_app(_APP_NAME)
            except ValueError:
                app = firebase_admin.initialize_app(
                    options={"projectId": project_id, "httpTimeout": 10},
                    name=_APP_NAME,
                )
            if app.project_id != project_id:
                raise _unavailable()
            return app
    except (ValueError, GoogleAuthError) as error:
        raise _unavailable() from error


def require_google_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    """Require a server-verified Firebase ID token from the configured project."""
    if (
        credentials is None
        or len(request.headers.getlist("authorization")) != 1
        or any(character.isspace() for character in credentials.credentials)
    ):
        raise _unauthorized()

    app = _get_firebase_app()
    try:
        claims = auth.verify_id_token(credentials.credentials, app=app, check_revoked=True)
    except (auth.InvalidIdTokenError, auth.UserDisabledError, auth.UserNotFoundError) as error:
        # Expired and revoked tokens are subclasses of InvalidIdTokenError.
        raise _unauthorized() from error
    except (
        exceptions.FirebaseError,
        GoogleAuthError,
        RequestException,
        ValueError,
    ) as error:
        # No SDK error details or tokens are sent back to the caller.
        raise _unavailable() from error

    firebase_claims = claims.get("firebase")
    uid = claims.get("uid")
    if (
        not isinstance(firebase_claims, dict)
        or firebase_claims.get("sign_in_provider") != "google.com"
        or not isinstance(uid, str)
        or not uid
    ):
        raise _unauthorized()

    return CurrentUser(
        uid=uid,
        email=claims.get("email") if isinstance(claims.get("email"), str) else None,
        displayName=claims.get("name") if isinstance(claims.get("name"), str) else None,
        photoURL=claims.get("picture") if isinstance(claims.get("picture"), str) else None,
    )
