"""
Principal auth — the fix for the biggest hole called out in README §1
("no authentication at all"). Every mutating consent/spend/revoke endpoint
now requires proof of *which principal* is acting, not just that a request
arrived.

Deliberately minimal: no user table, no login flow, no session store. A
principal's key is deterministically derived from its user_id and the same
AGENTGATE_HMAC_SECRET already used for consent integrity hashes (app/consent.py)
— HMAC(secret, user_id). A caller proves it holds the secret (and is thus a
trusted issuer/operator, e.g. the dashboard's backend-for-frontend proxy or a
demo script) by presenting the matching key for the principal it claims to
be. There is still no per-human login — that's real product work, not a
buildathon-week task — but a caller who does NOT hold AGENTGATE_HMAC_SECRET
can no longer create, spend against, or revoke ANY consent, which is the
concrete gap this closes. See README §1 for the full scoping note.
"""
import hashlib
import hmac

from fastapi import Header, HTTPException

from app.config import get_settings

settings = get_settings()


def derive_principal_key(principal_id: str) -> str:
    return hmac.new(
        settings.AGENTGATE_HMAC_SECRET.encode("utf-8"),
        principal_id.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def require_principal(
    x_principal_id: str = Header(..., alias="X-Principal-Id"),
    x_agentgate_key: str = Header(..., alias="X-AgentGate-Key"),
) -> str:
    """FastAPI dependency for mutating endpoints. Returns the authenticated
    principal id, or raises 401 if the presented key doesn't match it."""
    expected = derive_principal_key(x_principal_id)
    if not hmac.compare_digest(expected, x_agentgate_key):
        raise HTTPException(status_code=401, detail="invalid principal credentials")
    return x_principal_id
