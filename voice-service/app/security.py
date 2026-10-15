from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import parse_qs


def verify_ticket(query_string: bytes, secret: str) -> bool:
    if not secret:
        return False

    values = parse_qs(query_string.decode("ascii", errors="ignore"))
    expires_values = values.get("expires", [])
    nonce_values = values.get("nonce", [])
    signature_values = values.get("signature", [])

    if not expires_values or not nonce_values or not signature_values:
        return False

    expires = expires_values[0]
    nonce = nonce_values[0]
    signature = signature_values[0]

    try:
        expires_at = int(expires)
    except ValueError:
        return False

    now = int(time.time())
    if expires_at < now or expires_at > now + 60 or len(nonce) > 128:
        return False

    expected = hmac.new(
        secret.encode("utf-8"), f"{expires}.{nonce}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

