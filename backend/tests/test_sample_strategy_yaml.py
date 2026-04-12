from __future__ import annotations

from pathlib import Path

import yaml


def _repo_root() -> Path:
    # backend/tests/ -> repo root
    return Path(__file__).resolve().parents[2]


def test_sample_strategy_yamls_load_and_have_minimum_fields():
    configs_dir = _repo_root() / "backend" / "configs" / "strategies"
    assert configs_dir.exists()

    yamls = sorted(list(configs_dir.glob("*.yaml")))
    assert yamls, "Expected at least one sample strategy YAML"

    for p in yamls:
        cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
        assert isinstance(cfg, dict), f"{p.name} must parse to an object"

        # Keep this intentionally minimal so we don't lock down the strategy schema here.
        assert cfg.get("name"), f"{p.name} missing name"
        assert cfg.get("category"), f"{p.name} missing category"
        has_symbols = isinstance(cfg.get("symbols"), list) and bool(cfg.get("symbols"))
        has_pairs = isinstance(cfg.get("pairs"), list) and bool(cfg.get("pairs"))
        assert has_symbols or has_pairs, f"{p.name} missing symbols or pairs list"
        assert isinstance(cfg.get("entry"), dict), f"{p.name} missing entry block"
