import pytest


@pytest.mark.asyncio
async def test_critical_path_backtest_to_paper_with_global_kill(client):
    # 1) Create strategy
    r = await client.post(
        '/api/v1/strategies',
        json={
            'name': 'Critical Path Strategy',
            'category': 'custom',
            'config': {
                'entry': {
                    'conditions': [{'type': 'single', 'left': {'field': 'close'}, 'op': '>', 'right': 1}],
                },
            },
        },
    )
    assert r.status_code == 201
    version_id = r.json()['version_id']

    # 2) Create paper account + seed creds
    r = await client.post('/api/v1/accounts', json={'name': 'Critical Paper', 'mode': 'paper'})
    assert r.status_code == 201
    account_id = r.json()['id']

    from tests.conftest import seed_fake_credentials
    await seed_fake_credentials(client, account_id, 'paper')

    # 3) Promote strategy to paper deployment
    r = await client.post(
        '/api/v1/deployments/promote-to-paper',
        json={'strategy_version_id': version_id, 'account_id': account_id, 'notes': 'critical path'},
    )
    assert r.status_code == 200
    deployment_id = r.json()['id']

    # 4) Start deployment
    r = await client.post(f'/api/v1/deployments/{deployment_id}/start', json={})
    assert r.status_code == 200
    assert r.json()['status'] == 'running'

    # 5) Trigger global kill and verify platform state flips
    r = await client.post('/api/v1/control/kill-all', json={'reason': 'critical path stop', 'triggered_by': 'pytest'})
    assert r.status_code == 200
    assert r.json()['kill_switch']['global_killed'] is True

    # 6) Resume all and verify status clears
    r = await client.post('/api/v1/control/resume-all', json={'triggered_by': 'pytest'})
    assert r.status_code == 200
    assert r.json()['kill_switch']['global_killed'] is False
