async def test_create_account_with_capitalized_keys(client):
    payload = {"Name": "PaperTest1", "Mode": "Paper", "Initial Balance": 100000}
    resp = await client.post("/api/v1/accounts", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "PaperTest1"
    assert body["mode"] == "paper"
    assert float(body.get("initial_balance", 0)) == 100000.0


async def test_create_account_with_camelcase_keys(client):
    payload = {"name": "PaperTest2", "mode": "Paper", "initialBalance": 50000}
    resp = await client.post("/api/v1/accounts", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "PaperTest2"
    assert body["mode"] == "paper"
    assert float(body.get("initial_balance", 0)) == 50000.0
