import pytest


@pytest.mark.asyncio
async def test_strategy_scope_kill_pause_resume_events(client):
    strategy_id = 'strategy-scope-test'

    r = await client.post(f'/api/v1/control/kill-strategy/{strategy_id}', json={'reason': 'scope test'})
    assert r.status_code == 200
    assert r.json()['status'] == 'strategy_killed'

    r = await client.post(f'/api/v1/control/pause-strategy/{strategy_id}', json={})
    assert r.status_code == 200
    assert r.json()['status'] == 'strategy_paused'

    r = await client.post(f'/api/v1/control/resume-strategy/{strategy_id}', json={})
    assert r.status_code == 200
    assert r.json()['status'] == 'strategy_resumed'

    events = await client.get('/api/v1/control/kill-events', params={'limit': 20})
    assert events.status_code == 200
    data = events.json()['events']

    scoped = [e for e in data if e.get('scope') == 'strategy' and e.get('scope_id') == strategy_id]
    actions = {e['action'] for e in scoped}
    assert {'kill', 'pause', 'resume'}.issubset(actions)
