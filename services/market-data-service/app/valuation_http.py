"""Small bounded JSON body reader for public valuation queries only."""

import asyncio
import json

from fastapi import HTTPException

from folioview_shared.valuation import ValuationError


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


async def public_request(request, validator, limit, name):
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media != "application/json":
        raise HTTPException(415, f"Send a public {name} request as JSON.")
    try:
        async with asyncio.timeout(5):
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    raise HTTPException(413, "Valuation request is too large.")
                body.extend(chunk)
        return validator(json.loads(body, object_pairs_hook=unique_object))
    except (ValueError, UnicodeError, ValuationError, TimeoutError, RecursionError):
        raise HTTPException(400, f"Invalid {name} request.") from None
