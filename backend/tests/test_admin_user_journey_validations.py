import pytest


@pytest.mark.asyncio
async def test_user_journey_validations_endpoint_structure(client):
    r = await client.get("/api/v1/admin/user-journey-validations")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    assert "journeys" in data and isinstance(data["journeys"], list)
    assert "coverage_summary" in data and isinstance(data["coverage_summary"], list)
    assert "raw_markdown" in data and isinstance(data["raw_markdown"], str)


@pytest.mark.asyncio
async def test_user_journey_validations_parses_expected_count(client):
    r = await client.get("/api/v1/admin/user-journey-validations")
    assert r.status_code == 200, r.text
    data = r.json()
    journeys = data.get("journeys", [])
    # Document currently contains 150 journeys; parser should find them all
    assert len(journeys) == 150, f"expected 150 journeys, got {len(journeys)}"
    # spot-check first/last entries
    first = journeys[0]
    last = journeys[-1]
    for obj in (first, last):
        assert "id" in obj and isinstance(obj["id"], int)
        assert "title" in obj and isinstance(obj["title"], str)
        assert "status" in obj and obj["status"] in {"covered", "partial", "not_covered"}
