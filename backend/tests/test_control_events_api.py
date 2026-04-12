import pytest


@pytest.mark.asyncio
async def test_control_events_are_persisted_and_listed(client):
    # Trigger a global kill
    r = await client.post("/api/v1/control/kill-all", json={"reason": "test_kill", "triggered_by": "pytest"})
    assert r.status_code == 200

    # Trigger resume
    r = await client.post("/api/v1/control/resume-all", json={"triggered_by": "pytest"})
    assert r.status_code == 200

    # Ensure events come from DB and include required keys
    r = await client.get("/api/v1/control/kill-events", params={"limit": 10})
    assert r.status_code == 200
    body = r.json()
    assert "events" in body
    assert isinstance(body["events"], list)
    assert len(body["events"]) >= 2

    e0 = body["events"][0]
    for key in ["timestamp", "action", "scope", "reason", "triggered_by"]:
        assert key in e0


@pytest.mark.asyncio
async def test_control_status_tracks_latest_global_event(client):
    r = await client.post("/api/v1/control/kill-all", json={"reason": "roundtrip_test", "triggered_by": "pytest"})
    assert r.status_code == 200
    assert r.json()["kill_switch"]["global_killed"] is True
    assert r.json()["kill_switch"]["global_kill_reason"] == "roundtrip_test"

    r = await client.get("/api/v1/control/status")
    assert r.status_code == 200
    assert r.json()["kill_switch"]["global_killed"] is True
    assert r.json()["kill_switch"]["global_kill_reason"] == "roundtrip_test"

    r = await client.post("/api/v1/control/resume-all", json={"triggered_by": "pytest"})
    assert r.status_code == 200
    assert r.json()["kill_switch"]["global_killed"] is False

    r = await client.get("/api/v1/control/status")
    assert r.status_code == 200
    assert r.json()["kill_switch"]["global_killed"] is False

