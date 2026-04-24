#!/usr/bin/env python3
import json
from pathlib import Path

from app.api.routes import admin


def main() -> None:
    docs = Path(__file__).resolve().parents[1] / 'docs' / 'User_Journey_Validations.md'
    text = docs.read_text(encoding='utf-8')
    journeys = admin._parse_journeys(text)
    print(json.dumps(journeys, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
