import { expect, type Page, test } from '@playwright/test';
import { amountOf } from './session';

const rowsOf = (page: Page, owner: 'you' | 'system') =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: owner, exact: true }) });
const ownRows = (page: Page) => rowsOf(page, 'you');

test('lists the demo accounts beside the system accounts @smoke', async ({ page }) => {
  await page.goto('/dashboard/accounts');

  await expect(ownRows(page).first()).toBeVisible();
  await expect(rowsOf(page, 'system').first()).toBeVisible();
});

test('ends a statement at the balance the account reports @smoke', async ({ page }) => {
  await page.goto('/dashboard/accounts');
  await ownRows(page).first().getByRole('link', { name: 'Statement' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible();
  const summary = await page.getByRole('main').getByRole('paragraph').first().textContent();
  const lastBalance = await page.getByRole('row').last().getByRole('cell').last().textContent();
  expect(summary).toContain(lastBalance?.trim());
});

test('proves money is conserved and every hash chain is intact @smoke', async ({ page }) => {
  await page.goto('/dashboard/integrity');

  await expect(page.getByText('Conserved', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Intact' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Broken at/ })).toHaveCount(0);
});

test.describe('writes', () => {
  async function chooseOwnUsdPair(page: Page): Promise<{ from: string; to: string }> {
    const from = page.getByRole('combobox', { name: /^From/ });
    const own = from.locator('option').filter({ hasText: /^you · USD/ });
    await expect(own).toHaveCount(2);
    const fromLabel = (await own.nth(0).textContent()) ?? '';
    await from.selectOption({ label: fromLabel });
    const to = page
      .getByRole('combobox', { name: 'To' })
      .locator('option')
      .filter({
        hasText: /^you · USD/,
      });
    const toLabel = (await to.first().textContent()) ?? '';
    await page.getByRole('combobox', { name: 'To' }).selectOption({ label: toLabel });
    return { from: fromLabel, to: toLabel };
  }

  test('moves money between two of the owner’s accounts and both balances follow', async ({
    page,
  }) => {
    await page.goto('/dashboard/transfer');
    const before = await chooseOwnUsdPair(page);
    await page.getByRole('textbox', { name: /^Amount/ }).fill('1.25');
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByText('Posted', { exact: true })).toBeVisible();

    await page.reload();
    const id = (label: string) => label.split(' · ')[2]?.split(' ')[0] ?? '';
    const fromNow = page
      .locator('option')
      .filter({ hasText: id(before.from) })
      .first();
    const toNow = page
      .locator('option')
      .filter({ hasText: id(before.to) })
      .first();
    expect(amountOf((await fromNow.textContent()) ?? '')).toBeCloseTo(amountOf(before.from) - 1.25);
    expect(amountOf((await toNow.textContent()) ?? '')).toBeCloseTo(amountOf(before.to) + 1.25);
  });

  test('posts a retried transfer once when it reuses its idempotency key', async ({ page }) => {
    await page.goto('/dashboard/transfer');
    const before = await chooseOwnUsdPair(page);
    await page.getByRole('textbox', { name: /^Amount/ }).fill('2.00');
    await page.getByRole('textbox', { name: /^Idempotency key/ }).fill(`e2e-retry-${Date.now()}`);

    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByText('Posted', { exact: true })).toBeVisible();
    const first = await page.getByText('Posted', { exact: true }).locator('xpath=..').textContent();
    await page.getByRole('textbox', { name: /^Amount/ }).fill('2.00');
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByText('Posted', { exact: true })).toBeVisible();
    const second = await page
      .getByText('Posted', { exact: true })
      .locator('xpath=..')
      .textContent();
    expect(second).toBe(first);

    await page.reload();
    const id = before.from.split(' · ')[2]?.split(' ')[0] ?? '';
    const fromNow = page.locator('option').filter({ hasText: id }).first();
    expect(amountOf((await fromNow.textContent()) ?? '')).toBeCloseTo(amountOf(before.from) - 2);
  });

  test('opens a new account with a zero balance', async ({ page }) => {
    await page.goto('/dashboard/accounts');
    const jpy = ownRows(page).filter({ hasText: 'JPY' });
    const count = await jpy.count();

    await page.getByRole('combobox', { name: 'Currency' }).selectOption('JPY');
    await page.getByRole('button', { name: 'Open account' }).click();

    await expect(jpy).toHaveCount(count + 1);
  });

  test('keeps money conserved after the writes above', async ({ page }) => {
    await page.goto('/dashboard/integrity');

    await expect(page.getByText('Conserved', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^Broken at/ })).toHaveCount(0);
  });
});
