import pytest


async def test_bi_overview_returns_summary_and_accounts(client):
    resp = await client.get("/api/v1/bi/overview")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "summary" in body and isinstance(body["summary"], dict)
    summary = body["summary"]
    expected_keys = (
        "total_equity",
        "total_buying_power",
        "total_unrealized_pnl",
        "total_exposure",
        "accounts_monitored",
        "avg_leverage",
    )
    for k in expected_keys:
        assert k in summary
        assert isinstance(summary[k], (int, float))

    assert "accounts" in body and isinstance(body["accounts"], list)
