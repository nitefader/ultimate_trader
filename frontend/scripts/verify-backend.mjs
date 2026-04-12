#!/usr/bin/env node

const backendUrl = process.env.ULTRATRADER_BACKEND_URL || 'http://localhost:8000'
const endpoint = `${backendUrl.replace(/\/$/, '')}/api/v1/platform/info`
const expectedService = 'ultratrader-2026'

function fail(message) {
  console.error('')
  console.error('[UltraTrader preflight] Backend identity check failed.')
  console.error(message)
  console.error('Expected service:', expectedService)
  console.error('Checked endpoint:', endpoint)
  console.error('')
  process.exit(1)
}

async function main() {
  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    fail(`Cannot reach backend (${err?.message || 'unknown error'}). Start the backend and retry.`)
  }

  if (!response.ok) {
    fail(`Backend responded with HTTP ${response.status}.`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    fail('Backend response is not valid JSON.')
  }

  if (!payload || payload.service !== expectedService) {
    const got = payload && typeof payload === 'object' ? JSON.stringify(payload) : String(payload)
    fail(`Connected backend is not UltraTrader 2026. Received: ${got}`)
  }

  console.log('[UltraTrader preflight] Backend identity verified.')
  console.log(`service=${payload.service} version=${payload.version} mode=${payload.mode}`)
}

await main()
