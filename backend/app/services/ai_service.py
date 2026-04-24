"""AI service — wraps the default AI provider (Groq or Gemini) for structured generation."""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.data_service import DataService

logger = logging.getLogger(__name__)

_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_GEMINI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


async def _get_default_ai_service() -> DataService:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DataService).where(DataService.is_default_ai == True)  # noqa: E712
        )
        svc = result.scalars().first()
    if not svc:
        raise HTTPException(
            status_code=424,
            detail="No default AI service configured. Add a Groq or Gemini service in the Services tab and set it as default AI.",
        )
    if not svc.has_credentials():
        raise HTTPException(
            status_code=424,
            detail=f"Default AI service '{svc.name}' has no API key configured.",
        )
    return svc


async def chat_completion(system_prompt: str, user_prompt: str, temperature: float = 0.2) -> str:
    """Call the default AI provider and return the raw response text."""
    svc = await _get_default_ai_service()

    if svc.provider == "groq":
        return await _groq_chat(svc, system_prompt, user_prompt, temperature)
    if svc.provider == "gemini":
        return await _gemini_chat(svc, system_prompt, user_prompt, temperature)

    raise HTTPException(status_code=424, detail=f"Unsupported AI provider: {svc.provider}")


async def _groq_chat(svc: DataService, system_prompt: str, user_prompt: str, temperature: float) -> str:
    model = (svc.model or "llama-3.3-70b-versatile").strip()
    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {svc.api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(_GROQ_CHAT_URL, json=payload, headers=headers)
    if resp.status_code != 200:
        logger.error("Groq error %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502, detail=f"Groq API error: {resp.text[:200]}")
    data = resp.json()
    return data["choices"][0]["message"]["content"]


async def _gemini_chat(svc: DataService, system_prompt: str, user_prompt: str, temperature: float) -> str:
    model = (svc.model or "gemini-1.5-flash").strip()
    url = _GEMINI_CHAT_URL.format(model=model)
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "responseMimeType": "application/json",
        },
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, params={"key": svc.api_key})
    if resp.status_code != 200:
        logger.error("Gemini error %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502, detail=f"Gemini API error: {resp.text[:200]}")
    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise HTTPException(status_code=502, detail=f"Unexpected Gemini response shape: {exc}") from exc


async def generate_json(system_prompt: str, user_prompt: str, temperature: float = 0.2) -> Any:
    """Call AI and parse the result as JSON. Raises HTTPException on parse failure."""
    raw = await chat_completion(system_prompt, user_prompt, temperature)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("AI returned non-JSON: %s", raw[:500])
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {exc}") from exc
