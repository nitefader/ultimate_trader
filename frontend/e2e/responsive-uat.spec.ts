import { test, expect, type Page } from '@playwright/test'

const ROUTES = [
  { path: '/', ready: { kind: 'heading', name: 'Dashboard' } },
  { path: '/strategies/new', ready: { kind: 'heading', name: 'Strategy Builder' } },
  { path: '/backtest', ready: { kind: 'heading', name: 'Backtest Launcher' } },
  { path: '/services', ready: { kind: 'button', name: 'Add Data Service' } },
  { path: '/monitor', ready: { kind: 'heading', name: 'Live Monitor' } },
] as const

const VIEWPORTS = [
  { name: 'small-laptop', width: 1000, height: 700 },
  { name: 'laptop', width: 1280, height: 800 },
] as const

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    return {
      documentWidth: root.scrollWidth,
      viewportWidth: window.innerWidth,
      overflow: root.scrollWidth - window.innerWidth,
    }
  })

  expect(
    overflow.overflow,
    `Expected no horizontal page overflow, got ${overflow.overflow}px (document ${overflow.documentWidth}px vs viewport ${overflow.viewportWidth}px)`
  ).toBeLessThanOrEqual(2)
}

test.describe('Responsive UAT', () => {
  for (const viewport of VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      for (const route of ROUTES) {
        test(`${route.path} stays responsive`, async ({ page }) => {
          await page.goto(route.path)
          const main = page.locator('main')
          const readyLocator = route.ready.kind === 'heading'
            ? main.getByRole('heading', { name: route.ready.name })
            : main.getByRole('button', { name: route.ready.name })
          await expect(readyLocator).toBeVisible({ timeout: 15000 })
          await page.waitForTimeout(500)
          await expectNoPageOverflow(page)
        })
      }
    })
  }

  test.use({ viewport: { width: 1000, height: 700 } })

  test('navigation collapses into a drawer on smaller widths', async ({ page }) => {
    await page.goto('/')
    const menuButton = page.getByRole('button', { name: /open navigation menu/i })
    await expect(menuButton).toBeVisible()

    const sidebar = page.locator('aside')
    await expect(sidebar).toHaveClass(/-translate-x-full/)

    await menuButton.click()
    await expect(sidebar.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()

    await sidebar.getByRole('link', { name: 'Backtest', exact: true }).click()
    await expect(page.locator('main').getByRole('heading', { name: 'Backtest Launcher' })).toBeVisible({ timeout: 15000 })
    await expectNoPageOverflow(page)
  })
})
