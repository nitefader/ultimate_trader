from app.services.backtest_service import _allocate_persisted_trade_id


def test_allocate_persisted_trade_id_is_always_unique_for_rows() -> None:
    mapping: dict[str, str] = {}

    row1 = _allocate_persisted_trade_id("logical-trade-1", mapping)
    row2 = _allocate_persisted_trade_id("logical-trade-1", mapping)

    assert row1 != row2
    assert mapping["logical-trade-1"] == row1


def test_allocate_persisted_trade_id_without_source_does_not_touch_map() -> None:
    mapping: dict[str, str] = {}

    row = _allocate_persisted_trade_id(None, mapping)

    assert isinstance(row, str)
    assert row
    assert mapping == {}
