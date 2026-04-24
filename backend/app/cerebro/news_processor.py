"""NewsEventProcessor — Alpaca news websocket client with symbol-based relevance tagging."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)

ALPACA_NEWS_STREAM_URL = "wss://stream.data.alpaca.markets/v2/news"
_RECONNECT_BASE_S = 1.0
_RECONNECT_MAX_S = 60.0
_NEWS_CACHE_PER_SYMBOL = 50
_SEEN_IDS_MAX = 1000


@dataclass
class NewsEvent:
    news_id: str
    headline: str
    summary: str
    source: str
    url: str
    published_at: datetime
    symbols_mentioned: list[str]
    relevant_program_ids: list[str] = field(default_factory=list)
    relevance_score: float = 0.0


class NewsEventProcessor:
    def __init__(self) -> None:
        # symbol → deque of NewsEvent (last 50 per symbol)
        self._news_cache: dict[str, deque[NewsEvent]] = {}
        self._seen_ids: set[str] = set()
        self._seen_ids_queue: deque[str] = deque(maxlen=_SEEN_IDS_MAX)
        # callback set by CerebroEngine
        self._on_news: Callable[[dict], Awaitable[None]] | None = None
        # set of active symbols — injected by CerebroEngine
        self._active_symbols: Callable[[], set[str]] | None = None

    def set_on_news(self, cb: Callable[[dict], Awaitable[None]]) -> None:
        self._on_news = cb

    def set_active_symbols_provider(self, provider: Callable[[], set[str]]) -> None:
        self._active_symbols_provider = provider

    def get_recent_news(self, symbol: str, limit: int = 10) -> list[NewsEvent]:
        return list(self._news_cache.get(symbol.upper(), deque()))[-limit:]

    async def process_raw_news(self, raw: dict) -> None:
        news_id = str(raw.get("id", ""))
        if news_id in self._seen_ids:
            return
        self._seen_ids.add(news_id)
        self._seen_ids_queue.append(news_id)
        if len(self._seen_ids) > _SEEN_IDS_MAX:
            oldest = self._seen_ids_queue[0]
            self._seen_ids.discard(oldest)

        symbols = [s.upper() for s in raw.get("symbols", [])]
        try:
            pub_raw = raw.get("created_at") or raw.get("updated_at", "")
            pub_at = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00")) if pub_raw else datetime.now(timezone.utc)
        except Exception:
            pub_at = datetime.now(timezone.utc)

        event = NewsEvent(
            news_id=news_id,
            headline=str(raw.get("headline", "")),
            summary=str(raw.get("summary", "")),
            source=str(raw.get("source", "")),
            url=str(raw.get("url", "")),
            published_at=pub_at,
            symbols_mentioned=symbols,
        )

        # Cache per symbol
        for sym in symbols:
            if sym not in self._news_cache:
                self._news_cache[sym] = deque(maxlen=_NEWS_CACHE_PER_SYMBOL)
            self._news_cache[sym].append(event)

        # Tag relevance against active universe
        if hasattr(self, '_active_symbols_provider') and self._active_symbols_provider:
            active = self._active_symbols_provider()
            relevant = {s for s in symbols if s in active}
            event.relevance_score = len(relevant) / max(len(symbols), 1)
        else:
            relevant = set(symbols)

        if relevant and self._on_news:
            await self._on_news({
                "news_id": event.news_id,
                "headline": event.headline,
                "summary": event.summary,
                "source": event.source,
                "url": event.url,
                "published_at": event.published_at.isoformat(),
                "symbols_mentioned": event.symbols_mentioned,
                "relevant_symbols": list(relevant),
                "relevance_score": event.relevance_score,
            })


class NewsStreamClient:
    """Alpaca news websocket client. Runs as a background asyncio task."""

    def __init__(self, processor: NewsEventProcessor, api_key: str = "", secret_key: str = "") -> None:
        self.processor = processor
        self.api_key = api_key
        self.secret_key = secret_key
        self._stop_requested = False
        self._connected = False

    def configure_credentials(self, api_key: str, secret_key: str) -> None:
        self.api_key = api_key
        self.secret_key = secret_key

    def stop(self) -> None:
        self._stop_requested = True

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def run_forever(self) -> None:
        self._stop_requested = False
        delay = _RECONNECT_BASE_S
        attempts = 0

        while not self._stop_requested:
            if not self.api_key or not self.secret_key:
                logger.warning("NewsStreamClient: credentials not configured — waiting 10s")
                await asyncio.sleep(10)
                continue
            try:
                logger.info("NewsStreamClient: connecting (attempt %d)", attempts + 1)
                await self._run_once()
                delay = _RECONNECT_BASE_S
                attempts = 0
            except asyncio.CancelledError:
                break
            except Exception as exc:
                attempts += 1
                logger.warning("NewsStreamClient: error (attempt %d): %s — reconnect in %.1fs",
                               attempts, exc, delay)
            if self._stop_requested:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)

        self._connected = False
        logger.info("NewsStreamClient: stopped")

    async def _run_once(self) -> None:
        import websockets
        self._connected = False
        ws = await websockets.connect(ALPACA_NEWS_STREAM_URL)
        try:
            auth = json.dumps({"action": "auth", "key": self.api_key, "secret": self.secret_key})
            await ws.send(auth)
            sub = json.dumps({"action": "subscribe", "news": ["*"]})
            await ws.send(sub)
            self._connected = True
            logger.info("NewsStreamClient: connected and subscribed to news/*")

            while not self._stop_requested:
                raw_msg = await ws.recv()
                try:
                    messages = json.loads(raw_msg)
                    if isinstance(messages, dict):
                        messages = [messages]
                    for msg in messages:
                        if isinstance(msg, dict) and msg.get("T") == "n":
                            await self.processor.process_raw_news(msg)
                except Exception as exc:
                    logger.debug("NewsStreamClient: parse error: %s", exc)
        finally:
            self._connected = False
            await ws.close()
