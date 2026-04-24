"""Feature-engine support modules."""

from app.features.catalog import (
    feature_spec_from_ref,
    feature_spec_from_value_spec,
    is_supported_feature_ref,
    normalize_feature_ref_kind,
)
from app.features.keys import make_feature_key, make_runtime_identity_key, normalize_feature_params
from app.features.planner import FeaturePlan, build_feature_plan, estimate_feature_warmup_bars
from app.features.preview import build_feature_plan_preview, collect_feature_specs_from_config
from app.features.runtime_columns import resolve_runtime_columns
from app.features.source_contracts import (
    ALPACA_LIVE_PROVIDER,
    ALPACA_STREAM_CONTINUATION,
    FrameProvenance,
    RuntimeMode,
    WarmupSourceContract,
    YFINANCE_FALLBACK_PROVIDER,
    make_warmup_provenance,
    resolve_requested_provider,
    resolve_warmup_source_contract,
)
from app.features.specs import FeatureRequirement, FeatureSpec

__all__ = [
    "ALPACA_LIVE_PROVIDER",
    "ALPACA_STREAM_CONTINUATION",
    "FeatureRequirement",
    "FeaturePlan",
    "FeatureSpec",
    "FrameProvenance",
    "RuntimeMode",
    "WarmupSourceContract",
    "YFINANCE_FALLBACK_PROVIDER",
    "build_feature_plan_preview",
    "feature_spec_from_ref",
    "feature_spec_from_value_spec",
    "is_supported_feature_ref",
    "build_feature_plan",
    "collect_feature_specs_from_config",
    "estimate_feature_warmup_bars",
    "make_feature_key",
    "make_runtime_identity_key",
    "make_warmup_provenance",
    "normalize_feature_params",
    "normalize_feature_ref_kind",
    "resolve_runtime_columns",
    "resolve_requested_provider",
    "resolve_warmup_source_contract",
]
