import { test, expect } from '@playwright/test'

// Browser critical-path smoke test scaffold.
// Assumes backend and frontend dev servers are running.

test('critical navigation path renders core pages', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.getByRole('link', { name: 'Backtest', exact: true }).click()
  await expect(page.getByText('Backtest Launcher')).toBeVisible()

  await page.getByRole('link', { name: 'Run History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Run History' })).toBeVisible()

  await page.getByRole('link', { name: /Accounts/i }).click()
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()

  await page.getByRole('link', { name: /Services/i }).click()
  await expect(page.getByRole('button', { name: 'Data Services' })).toBeVisible()
})
