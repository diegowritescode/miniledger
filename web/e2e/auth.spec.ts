import { expect, test } from '@playwright/test';
import { DEMO_EMAIL, NO_SESSION, signInAsDemo } from './session';

test('shows the AccessCore identity on the overview @smoke', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(DEMO_EMAIL);
});

test.describe('without a session', () => {
  test.use({ storageState: NO_SESSION });

  test('sends an anonymous visitor to the login page @smoke', async ({ page }) => {
    await page.goto('/dashboard/accounts');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to MiniLedger' })).toBeVisible();
  });

  test('rejects unknown credentials without starting a session', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole('textbox', { name: /^Password/ }).fill('not the password at all');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signs out and closes the dashboard', async ({ page }) => {
    await signInAsDemo(page);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
