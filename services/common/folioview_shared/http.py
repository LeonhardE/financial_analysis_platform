"""HTTP boundaries shared by independently deployed FolioView services."""

import os
from collections.abc import Sequence

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class PrivateRoute(APIRoute):
    unavailable_message = "This service is temporarily unavailable. Please try again later."

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                return await handler(request)
            except (HTTPException, RequestValidationError):
                raise
            except Exception as error:
                raise HTTPException(503, self.unavailable_message) from error

        return private_handler


class PrivateResponseHeaders:
    """Prevent private success, validation, auth, missing-route and CORS caching."""

    def __init__(self, app: ASGIApp, prefixes: Sequence[str] = ("/api/",)):
        self.app = app
        self.prefixes = tuple(prefixes)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.prefixes):
            await self.app(scope, receive, send)
            return

        async def private_send(message: Message):
            if message["type"] == "http.response.start":
                headers = [
                    pair for pair in message.get("headers", []) if pair[0] != b"cache-control"
                ]
                message = {**message, "headers": [*headers, (b"cache-control", b"no-store")]}
            await send(message)

        await self.app(scope, receive, private_send)


def create_app(
    title: str,
    *,
    private: bool = False,
    methods: Sequence[str] = ("GET",),
    description: str = "",
    private_prefixes: Sequence[str] = ("/api/",),
) -> FastAPI:
    app = FastAPI(title=title, version="0.1.0", description=description)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
            ).split(",")
            if origin.strip()
        ],
        allow_credentials=False,
        allow_methods=list(methods),
        allow_headers=["*"],
    )
    if private:
        app.router.route_class = PrivateRoute
        app.add_middleware(PrivateResponseHeaders, prefixes=private_prefixes)
    return app
