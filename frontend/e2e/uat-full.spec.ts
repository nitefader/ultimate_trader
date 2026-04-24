import { test, expect, type Locator, type Page } from '@playwright/test'

const main = (page: Page) => page.locator('main')

function readyLocator(page: Page, kind: 'heading' | 'button' | 'text', name: string | RegExp): Locator {
  if (kind === 'heading') return main(page).getByRole('heading', { name })
  if (kind === 'button') return main(page).getByRole('button', { name })
  return main(page).getByText(name)
}

test.describe('App Shell', () => {
  test('sidebar renders the current nav model', async ({ page }) => {
    await page.goto('/')

    const sidebar = page.locator('aside')
    await expect(sidebar.getByText('UltraTrader')).toBeVisible()
    await expect(sidebar.getByText('2026 Edition')).toBeVisible()

    const navLinks = [
      'Dashboard', 'Strategies', 'Watchlists', 'Risk Profiles', 'Governors', 'Exec Styles',
      'Sim Lab', 'Backtest', 'Run History', 'Chart Lab', 'Optim. Lab',
      'Programs', 'Deploy', 'Live Monitor', 'Accounts',
      'Services', 'Credentials', 'Data', 'Events', 'Backup', 'Logs',
    ]

    for (const label of navLinks) {
      await expect(page.getByRole('navigation').getByRole('link', { name: label, exact: true })).toBeVisible()
    }
  })

  test('header shows kill switch controls', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header')).toBeVisible()
    await expect(page.getByRole('button', { name: /halt all/i })).toBeVisible()
  })
})

test.describe('Dashboard', () => {
  test('dashboard renders core content', async ({ page }) => {
    await page.goto('/')
    await expect(main(page).getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(main(page).getByRole('link', { name: /new strategy/i })).toBeVisible()
    await expect(main(page).getByRole('link', { name: /run backtest/i })).toBeVisible()
  })
})

test.describe('Strategies', () => {
  test('strategies list loads', async ({ page }) => {
    await page.goto('/strategies')
    await expect(main(page).getByRole('heading', { name: 'Strategies' })).toBeVisible()
  })

  test('new strategy launches the builder', async ({ page }) => {
    await page.goto('/strategies')
    await main(page).getByRole('link', { name: /new strategy/i }).first().click()
    await expect(page).toHaveURL('/strategies/new')
    await expect(main(page).getByRole('heading', { name: 'Strategy Builder' })).toBeVisible()
  })
})

test.describe('Strategy Builder', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.dismiss())
    await page.goto('/strategies/new')
    await expect(main(page).getByRole('heading', { name: 'Strategy Builder' })).toBeVisible({ timeout: 15000 })
  })

  test('builder shell renders blueprint, tabs, and action bar', async ({ page }) => {
    await expect(main(page).getByText('Blueprint')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Core/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Signals/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Validate' })).toBeVisible()
    await expect(page.getByRole('button', { name: /save strategy/i })).toBeVisible()
  })

  test('core tab shows editable strategy metadata', async ({ page }) => {
    const content = main(page)
    await expect(content.getByRole('heading', { name: 'Strategy Info' })).toBeVisible()
    await expect(content.getByText('Hypothesis (your edge)')).toBeVisible()
    await expect(content.getByText('Trading Mode')).toBeVisible()

    const nameInput = content.locator('#strategy-info input').first()
    await nameInput.fill('UAT Swing Breakout')
    await expect(nameInput).toHaveValue('UAT Swing Breakout')

    await content.getByRole('button', { name: /position/i }).click()
    await expect(content.getByText('Position', { exact: false }).first()).toBeVisible()
  })

  test('signals tab shows rules, stops, and targets', async ({ page }) => {
    await page.getByRole('button', { name: /^Signals/ }).click()
    const content = main(page)

    await expect(content.getByRole('heading', { name: 'Entry Rules' })).toBeVisible()
    await expect(content.getByRole('heading', { name: 'Stop Loss' })).toBeVisible()
    await expect(content.getByRole('heading', { name: 'Profit Targets' })).toBeVisible()
    await expect(content.getByRole('button', { name: /add study trigger/i }).first()).toBeVisible()
    await expect(content.getByRole('button', { name: /add target/i })).toBeVisible()
  })

  test('adding a study trigger updates the signals tab', async ({ page }) => {
    await page.getByRole('button', { name: /^Signals/ }).click()
    const content = main(page)

    await content.getByRole('button', { name: /add study trigger/i }).first().click()
    await expect(content.getByText('Rule 1')).toBeVisible()
    await expect(content.getByRole('button', { name: /mirror long/i })).toBeVisible()
  })

  test('validate and save remain blocked until required blueprint items are complete', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Validate' })).toBeDisabled()
    await expect(page.getByRole('button', { name: /save strategy/i })).toBeDisabled()
  })
})

test.describe('Backtest Launcher', () => {
  test('launcher renders primary controls', async ({ page }) => {
    await page.goto('/backtest')
    await expect(main(page).getByRole('heading', { name: 'Backtest Launcher' })).toBeVisible()
    await expect(main(page).getByText(/data provider/i).first()).toBeVisible()
    await expect(main(page).getByText(/walk-forward/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /launch/i })).toBeVisible()
  })
})

test.describe('Accounts', () => {
  test('accounts page renders and can open the add account modal', async ({ page }) => {
    await page.goto('/accounts')
    await expect(main(page).getByRole('heading', { name: 'Accounts' })).toBeVisible()

    const addAccount = page.getByRole('button', { name: /add account/i }).first()
    await addAccount.click()
    await expect(page.getByText(/alpaca/i).first()).toBeVisible()
  })
})

test.describe('Services', () => {
  test('services page renders current tabs and create actions', async ({ page }) => {
    await page.goto('/services')
    await expect(main(page).getByRole('button', { name: 'Data Services' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Add Data Service' })).toBeVisible()

    await main(page).getByRole('button', { name: 'AI Services' }).click()
    await expect(main(page).getByRole('button', { name: 'Add AI Service' })).toBeVisible()
  })
})

test.describe('Deploy And Monitor', () => {
  test('account governor page renders', async ({ page }) => {
    await page.goto('/deployments')
    await expect(main(page).getByRole('heading', { name: 'Account Governor' })).toBeVisible()
    await expect(main(page).getByText('Active Deployments')).toBeVisible()
  })

  test('live monitor page renders', async ({ page }) => {
    await page.goto('/monitor')
    await expect(main(page).getByRole('heading', { name: 'Live Monitor' })).toBeVisible()
  })
})

test.describe('Data And Logs', () => {
  test('data manager wizard opens and shows provider cards', async ({ page }) => {
    await page.goto('/data')
    await expect(main(page).getByRole('heading', { name: 'Data Manager' })).toBeVisible()

    await page.getByRole('button', { name: /download data/i }).click()
    await expect(page.getByText(/alpaca markets/i).first()).toBeVisible()
  })

  test('logs page renders', async ({ page }) => {
    await page.goto('/logs')
    await expect(main(page).getByRole('heading', { name: /logs/i })).toBeVisible()
  })
})

test.describe('Navigation Coherence', () => {
  test('sidebar routes resolve without crashing', async ({ page }) => {
    await page.goto('/')

    const routes: Array<{ nav: string; ready: { kind: 'heading' | 'button' | 'text'; name: string | RegExp } }> = [
      { nav: 'Strategies', ready: { kind: 'heading', name: 'Strategies' } },
      { nav: 'Backtest', ready: { kind: 'heading', name: 'Backtest Launcher' } },
      { nav: 'Run History', ready: { kind: 'heading', name: 'Run History' } },
      { nav: 'Accounts', ready: { kind: 'heading', name: 'Accounts' } },
      { nav: 'Services', ready: { kind: 'button', name: 'Add Data Service' } },
      { nav: 'Data', ready: { kind: 'heading', name: 'Data Manager' } },
      { nav: 'Events', ready: { kind: 'heading', name: /event|calendar/i } },
      { nav: 'Logs', ready: { kind: 'heading', name: /logs/i } },
      { nav: 'Deploy', ready: { kind: 'heading', name: 'Account Governor' } },
    ]

    for (const route of routes) {
      await page.getByRole('navigation').getByRole('link', { name: route.nav, exact: true }).click()
      await expect(page.getByText('Loading page...')).not.toBeVisible({ timeout: 8000 }).catch(() => {})
      await expect(readyLocator(page, route.ready.kind, route.ready.name)).toBeVisible({ timeout: 15000 })
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    }
  })

  test('browser back and forward still work', async ({ page }) => {
    await page.goto('/')
    await page.goto('/strategies')
    await page.goto('/backtest')
    await page.goBack()
    await expect(page).toHaveURL('/strategies')
    await page.goForward()
    await expect(page).toHaveURL('/backtest')
  })
})
