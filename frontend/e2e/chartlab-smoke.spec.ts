import { test, expect } from '@playwright/test'

test('Chart Lab intraday smoke', async ({ page }) => {
  await page.goto('/charts')
  await expect(page.getByRole('heading', { name: 'Chart Lab' })).toBeVisible({ timeout: 15000 })

  // Wait for the selects (strategy, symbol, timeframe, limit)
  await page.waitForSelector('select', { timeout: 15000 })
  const selects = page.locator('select')
  const count = await selects.count()
  expect(count).toBeGreaterThanOrEqual(2)

  const symbolSel = selects.nth(1)
  const tfSel = selects.nth(2)

  // Pick first available non-empty symbol option
  const symbolOptions = await symbolSel.locator('option').all()
  if (symbolOptions.length === 0) throw new Error('No symbol options available')
  let symIndex = 0
  for (let i = 0; i < symbolOptions.length; i++) {
    const v = await symbolOptions[i].getAttribute('value')
    const t = (await symbolOptions[i].textContent()) ?? ''
    if ((v && v.trim() !== '') || t.trim() !== '') { symIndex = i; break }
  }
  await symbolSel.selectOption({ index: symIndex })

  // Choose a preferred intraday timeframe if present
  const tfOptions = await tfSel.locator('option').all()
  if (tfOptions.length > 0) {
    const preferred = ['1m','5m','15m','30m','60m','1h']
    let tfIndex = 0
    for (let i = 0; i < tfOptions.length; i++) {
      const v = (await tfOptions[i].getAttribute('value')) ?? (await tfOptions[i].textContent()) ?? ''
      if (preferred.includes(v.trim())) { tfIndex = i; break }
      if (v.trim() !== '') tfIndex = i
    }
    await tfSel.selectOption({ index: tfIndex })
  }

  // Wait for the chart SVG to render
  await page.waitForSelector('svg', { timeout: 15000 })
  const svg = page.locator('svg').first()
  await expect(svg).toBeVisible()

  // Screenshot for visual inspection
  await page.screenshot({ path: 'test-results/chartlab-smoke.png', fullPage: false })
})
