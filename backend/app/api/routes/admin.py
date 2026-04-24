"""Admin endpoints — database backup and restore."""
from __future__ import annotations

import io
import os
import shutil
import tempfile
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
import re
from typing import Any

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_DB_FILENAME = "ultratrader.db"


class UserJourney(BaseModel):
    id: int
    domain: str
    title: str
    pages_components: str
    api_routes: str
    required_steps: str
    edge_cases: str
    priority: str
    status: str
    raw_status: str

    model_config = ConfigDict(from_attributes=True)


class CoverageSummaryRow(BaseModel):
    domain: str
    total: int | None = None
    covered: int | None = None
    partial: int | None = None
    not_covered: int | None = None

    model_config = ConfigDict(from_attributes=True)


class UserJourneyValidationsResponse(BaseModel):
    journeys: list[UserJourney]
    coverage_summary: list[CoverageSummaryRow]
    raw_markdown: str

    model_config = ConfigDict(from_attributes=True)


def _db_path() -> Path:
    """Resolve path to the SQLite file regardless of cwd."""
    from app.config import settings
    url = settings.DATABASE_URL
    # e.g. sqlite+aiosqlite:///./ultratrader.db  or  sqlite+aiosqlite:////abs/path
    if "sqlite" not in url:
        raise HTTPException(status_code=400, detail="Backup/restore only supported for SQLite databases")
    # strip driver prefix
    raw = url.split("///", 1)[-1]
    p = Path(raw)
    if not p.is_absolute():
        # relative to repo root (backend is run from repo root)
        p = Path.cwd() / p
    return p.resolve()


@router.get("/backup")
async def download_backup():
    """
    Stream the SQLite database file as a binary download.
    Filename includes UTC timestamp so backups don't overwrite each other.
    """
    db = _db_path()
    if not db.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    download_name = f"ultratrader_backup_{ts}.db"

    # Copy to a temp file so we don't stream while SQLite holds a lock
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    try:
        shutil.copy2(db, tmp.name)
        tmp.close()
        data = Path(tmp.name).read_bytes()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    logger.info("admin: backup downloaded (%d bytes)", len(data))

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


@router.post("/restore")
async def upload_restore(file: UploadFile = File(...)):
    """
    Replace the current database with an uploaded backup.

    Validates that the uploaded file is a valid SQLite3 file before replacing.
    Creates a timestamped backup of the current DB first.
    """
    db = _db_path()

    content = await file.read()

    # SQLite3 magic header: first 16 bytes = "SQLite format 3\000"
    if len(content) < 16 or content[:15] != b"SQLite format 3":
        raise HTTPException(
            status_code=400,
            detail="Uploaded file does not appear to be a valid SQLite3 database",
        )

    # Back up current DB before overwriting
    if db.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        pre_restore_backup = db.with_name(f"ultratrader_pre_restore_{ts}.db")
        shutil.copy2(db, pre_restore_backup)
        logger.info("admin: pre-restore backup saved to %s", pre_restore_backup)

    # Write new DB atomically via temp file
    tmp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".db",
        dir=db.parent,
    )
    try:
        tmp.write(content)
        tmp.close()
        shutil.move(tmp.name, db)
    except Exception as exc:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        logger.exception("admin: restore failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}") from exc

    logger.info("admin: database restored from upload (%d bytes)", len(content))

    return JSONResponse({
        "status": "restored",
        "bytes": len(content),
        "message": "Database replaced. Restart the server to reinitialize connections.",
    })


def _parse_journeys(md: str) -> list[dict]:
    """Extract journey rows from the markdown tables.

    Returns a list of dicts with keys:
    id, domain, title, pages_components, api_routes, required_steps, edge_cases, priority, status, raw_status
    """
    journeys: list[dict] = []
    current_domain = "Uncategorized"

    for line in md.splitlines():
        raw = line.strip()
        if raw.startswith("## "):
            current_domain = re.sub(r"\s*\(\d+\s*[–-]\s*\d+\)\s*$", "", raw[3:]).strip()
            continue
        # Only consider table rows that start with '|'
        if not raw.startswith('|'):
            continue
        # Skip markdown separator rows like '|---|---|---|'
        if all(c in "|-: " for c in raw):
            continue

        # Split columns by '|' and trim
        cols = [c.strip() for c in raw.strip('|').split('|')]
        # Expect at least 8 columns:
        # number, title, pages, api_routes, required_steps, edge_cases, priority, status
        if len(cols) < 8:
            continue

        first = cols[0]
        try:
            num = int(first)
        except Exception:
            # not a numbered journey row
            continue

        title = cols[1]
        pages = cols[2]
        api_routes = cols[3]
        required_steps = cols[4]
        edge_cases = cols[5]
        priority = cols[6]
        raw_status = cols[7].strip().strip('`').strip()

        rs = raw_status.lower()
        if rs == '[x]':
            status = 'covered'
        elif rs == '[~]':
            status = 'partial'
        else:
            status = 'not_covered'

        journeys.append({
            'id': num,
            'domain': current_domain,
            'title': title,
            'pages_components': pages,
            'api_routes': api_routes,
            'required_steps': required_steps,
            'edge_cases': edge_cases,
            'priority': priority,
            'status': status,
            'raw_status': raw_status,
        })

    # Sort by id to preserve document order
    journeys.sort(key=lambda x: x['id'])
    return journeys


def _parse_coverage_summary(md: str) -> list[dict]:
    """Parse the Coverage Summary table into structured rows."""
    idx = md.find('## Coverage Summary')
    if idx == -1:
        return []
    segment = md[idx:]
    lines = segment.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith('|') and 'Domain' in line and 'Total' in line:
            header_idx = i
            break
    if header_idx is None:
        return []
    rows: list[dict] = []
    for line in lines[header_idx + 2:]:
        if not line.strip().startswith('|'):
            break
        cols = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cols) < 5:
            continue
        domain, total, covered, partial, not_covered = cols[:5]
        try:
            total_i = int(total)
        except Exception:
            total_i = None
        try:
            covered_i = int(covered)
        except Exception:
            covered_i = None
        try:
            partial_i = int(partial)
        except Exception:
            partial_i = None
        try:
            not_covered_i = int(not_covered)
        except Exception:
            not_covered_i = None
        rows.append({
            'domain': domain,
            'total': total_i,
            'covered': covered_i,
            'partial': partial_i,
            'not_covered': not_covered_i,
        })
    return rows


@router.get('/user-journey-validations', response_model=UserJourneyValidationsResponse)
async def get_user_journey_validations() -> UserJourneyValidationsResponse:
    """Return structured user journey validations parsed from the docs file.

    Falls back to returning the raw markdown if parsing fails.
    """
    docs_path = Path(__file__).resolve().parents[4] / 'docs' / 'User_Journey_Validations.md'
    if not docs_path.exists():
        raise HTTPException(status_code=404, detail='User journey validations document not found')
    text = docs_path.read_text(encoding='utf-8')
    journeys = _parse_journeys(text)
    coverage = _parse_coverage_summary(text)
    return {
        'journeys': journeys,
        'coverage_summary': coverage,
        'raw_markdown': text,
    }
