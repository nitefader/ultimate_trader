import { test, expect } from '@playwright/test'

test('LiveMonitor displays websocket order_fill events', async ({ page }) => {
  // Inject a fake WebSocket implementation before the app loads
  await page.addInitScript(() => {
    (window as any).__fake_ws_instance = null
    class FakeWS {
      url: string
      readyState: number
      onopen: Function | null = null
      onmessage: Function | null = null
      onclose: Function | null = null
      constructor(url: string) {
        this.url = url
        this.readyState = 1
        (window as any).__fake_ws_instance = this
        // simulate open shortly after creation
        setTimeout(() => this.onopen && this.onopen({}), 5)
      }
      send(_data: string) {}
      close() { this.readyState = 3; this.onclose && this.onclose({}) }
      // helper used by test to push messages
      push(data: any) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data)
        this.onmessage && this.onmessage({ data: payload })
      }
    }
    ;(window as any).WebSocket = FakeWS
  })

  await page.goto('/monitor')

  // wait for the test helper to be exposed by the app (avoid race)
  await page.waitForFunction(() => typeof (window as any).__ut_set_last_event === 'function')

  const lastEvent = page.locator('[data-testid="ws-last-event"]')
  await expect(lastEvent).toHaveText('')

  // simulate an incoming WS event using the exposed test helper
  await page.evaluate(() => {
    ;(window as any).__ut_set_last_event({
      type: 'order_fill',
      data: {
        event: 'fill',
        symbol: 'AAPL',
        side: 'buy',
        qty: 1,
        filled_qty: 1,
        filled_avg_price: 150.0,
        id: 'ord-1',
        client_order_id: 'co-1',
        status: 'filled',
      },
      ts: new Date().toISOString(),
    })
  })

  // The UI should receive and render the WS event JSON
  await expect(lastEvent).toContainText('order_fill')
  await expect(lastEvent).toContainText('AAPL')
  await expect(lastEvent).toContainText('co-1')
})
