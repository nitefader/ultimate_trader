"""
Security utilities — AES-GCM encryption for sensitive broker credentials.

Credentials are encrypted at rest using a key derived from ENCRYPTION_KEY env var.
The IV is random per encryption so each ciphertext is unique.
Secrets returned via API are always masked: first4****last4.
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Salt is derived from a fixed prefix + the ENCRYPTION_KEY itself so that
# changing the key also changes the salt (no hardcoded constant).
_BASE_SALT = b"ultratrader-2026-credential-salt"


def _derive_key(encryption_key: str) -> bytes:
    """Derive a 32-byte AES key from the ENCRYPTION_KEY setting."""
    salt = _BASE_SALT + encryption_key[:8].encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=200_000,
    )
    return kdf.derive(encryption_key.encode())


def _get_encryption_key() -> str:
    """Read ENCRYPTION_KEY from environment (lazy import to avoid circular deps)."""
    try:
        from app.config import get_settings
        key = get_settings().ENCRYPTION_KEY
        if not key:
            raise RuntimeError("ENCRYPTION_KEY is required")
        return key
    except Exception:
        env_key = os.environ.get("ENCRYPTION_KEY", "")
        if not env_key:
            raise RuntimeError("ENCRYPTION_KEY is required")
        return env_key


def encrypt_secret(value: str) -> str:
    """Encrypt a secret string. Returns base64-encoded iv+tag+ciphertext."""
    key = _derive_key(_get_encryption_key())
    iv = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
    enc = cipher.encryptor()
    ct = enc.update(value.encode()) + enc.finalize()
    return base64.b64encode(iv + enc.tag + ct).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a secret produced by encrypt_secret. Raises ValueError on failure."""
    key = _derive_key(_get_encryption_key())
    try:
        raw = base64.b64decode(token)
        iv, tag, ct = raw[:12], raw[12:28], raw[28:]
        cipher = Cipher(algorithms.AES(key), modes.GCM(iv, tag))
        dec = cipher.decryptor()
        return (dec.update(ct) + dec.finalize()).decode()
    except Exception as exc:
        raise ValueError(f"Failed to decrypt secret: {exc}") from exc


def mask_secret(value: str, show: int = 4) -> str:
    """Return a masked version: first N + **** + last N."""
    if len(value) <= show * 2:
        return "*" * len(value)
    return value[:show] + "****" + value[-show:]


def encrypt_broker_config(config: dict[str, Any]) -> dict[str, Any]:
    """
    Encrypt sensitive fields (api_key, secret_key) within a broker_config dict.
    Structure: {paper: {api_key, secret_key, base_url}, live: {api_key, secret_key, base_url}}
    Encrypted values are prefixed with 'enc:' to distinguish from plaintext.
    """
    result: dict[str, Any] = {}
    for mode, settings in config.items():
        if not isinstance(settings, dict):
            result[mode] = settings
            continue
        encrypted_mode: dict[str, Any] = dict(settings)
        for field in ("api_key", "secret_key"):
            raw = settings.get(field, "")
            if raw and not raw.startswith("enc:"):
                encrypted_mode[field] = "enc:" + encrypt_secret(raw)
        result[mode] = encrypted_mode
    return result


def decrypt_broker_config(config: dict[str, Any]) -> dict[str, Any]:
    """Decrypt all encrypted fields in a broker_config. Returns plaintext config."""
    result: dict[str, Any] = {}
    for mode, settings in config.items():
        if not isinstance(settings, dict):
            result[mode] = settings
            continue
        decrypted_mode: dict[str, Any] = dict(settings)
        for field in ("api_key", "secret_key"):
            val = settings.get(field, "")
            if val and val.startswith("enc:"):
                try:
                    decrypted_mode[field] = decrypt_secret(val[4:])
                except ValueError:
                    decrypted_mode[field] = ""  # decryption failed — treat as empty
        result[mode] = decrypted_mode
    return result


def mask_broker_config(config: dict[str, Any]) -> dict[str, Any]:
    """Return config with secrets masked — safe to send to the frontend."""
    decrypted = decrypt_broker_config(config)
    result: dict[str, Any] = {}
    for mode, settings in decrypted.items():
        if not isinstance(settings, dict):
            result[mode] = settings
            continue
        masked = dict(settings)
        for field in ("api_key", "secret_key"):
            val = settings.get(field, "")
            if val:
                masked[field] = mask_secret(val)
        result[mode] = masked
    return result


# ── Legacy helpers (kept for any existing callers) ────────────────────────────

def encrypt_data(data: Any, password: str) -> str:
    """Encrypt arbitrary JSON-serialisable data."""
    key = _derive_key(password)
    iv = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
    enc = cipher.encryptor()
    ct = enc.update(json.dumps(data).encode()) + enc.finalize()
    return base64.b64encode(iv + enc.tag + ct).decode()


def decrypt_data(token: str, password: str) -> Any:
    """Decrypt data encrypted by encrypt_data."""
    key = _derive_key(password)
    raw = base64.b64decode(token)
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv, tag))
    dec = cipher.decryptor()
    return json.loads((dec.update(ct) + dec.finalize()).decode())
