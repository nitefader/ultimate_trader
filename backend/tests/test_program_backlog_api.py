import pytest


@pytest.mark.asyncio
async def test_backlog_list_seeds_defaults(client):
    r = await client.get("/api/v1/backlog")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 4
    assert any(item["title"] == "Promotion safety contract" for item in data)
    assert all("order_index" in item for item in data)
    assert all("blocked_by_ids" in item for item in data)


@pytest.mark.asyncio
async def test_backlog_create_and_update(client):
    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Completed dependency A",
            "objective": "Dependency",
            "scope": "Prerequisite",
            "business_impact": "Allows downstream slice",
            "order_index": 52,
            "blocked_by_ids": [],
            "status": "completed",
            "review": "passed",
            "verification": "Done",
            "next_gate": "Ready",
        },
    )
    assert r.status_code == 200
    dep_a = r.json()

    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Completed dependency B",
            "objective": "Dependency",
            "scope": "Prerequisite",
            "business_impact": "Allows downstream slice",
            "order_index": 53,
            "blocked_by_ids": [],
            "status": "completed",
            "review": "passed",
            "verification": "Done",
            "next_gate": "Ready",
        },
    )
    assert r.status_code == 200
    dep_b = r.json()

    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Shared backlog persistence",
            "objective": "Move program slices out of local storage.",
            "scope": "Backend persistence and frontend query wiring.",
            "business_impact": "Shared oversight across environments.",
            "order_index": 55,
            "blocked_by_ids": [],
            "status": "in_progress",
            "review": "in_review",
            "verification": "API added",
            "next_gate": "Wire frontend to API",
        },
    )
    assert r.status_code == 200
    item = r.json()
    assert item["title"] == "Shared backlog persistence"

    r = await client.put(
        f"/api/v1/backlog/{item['id']}",
        json={
            "order_index": 65,
            "blocked_by_ids": [dep_a["id"], dep_b["id"]],
            "status": "completed",
            "review": "passed",
            "verification": "API and UI verified",
        },
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["order_index"] == 65
    assert updated["blocked_by_ids"] == [dep_a["id"], dep_b["id"]]
    assert updated["status"] == "completed"
    assert updated["review"] == "passed"


@pytest.mark.asyncio
async def test_backlog_blocks_starting_when_dependencies_incomplete(client):
    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Dependency base",
            "objective": "Base slice",
            "scope": "Base work",
            "business_impact": "Provides prerequisite",
            "order_index": 500,
            "blocked_by_ids": [],
            "status": "queued",
            "review": "not_started",
            "verification": "Pending",
            "next_gate": "Complete first",
        },
    )
    assert r.status_code == 200
    dep = r.json()

    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Blocked slice",
            "objective": "Depends on base",
            "scope": "Dependent work",
            "business_impact": "Should not start early",
            "order_index": 510,
            "blocked_by_ids": [dep["id"]],
            "status": "in_progress",
            "review": "not_started",
            "verification": "Pending",
            "next_gate": "Wait for dependency",
        },
    )
    assert r.status_code == 400

    r = await client.post(
        "/api/v1/backlog",
        json={
            "title": "Blocked slice",
            "objective": "Depends on base",
            "scope": "Dependent work",
            "business_impact": "Should not start early",
            "order_index": 510,
            "blocked_by_ids": [dep["id"]],
            "status": "queued",
            "review": "not_started",
            "verification": "Pending",
            "next_gate": "Wait for dependency",
        },
    )
    assert r.status_code == 200
    blocked = r.json()

    r = await client.put(
        f"/api/v1/backlog/{blocked['id']}",
        json={"status": "in_progress"},
    )
    assert r.status_code == 400
