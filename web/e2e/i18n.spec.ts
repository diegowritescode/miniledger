import { expect, test } from '@playwright/test';

test('switches the dashboard to Spanish and keeps it across pages', async ({ page }) => {
  await page.goto('/dashboard');

  await page.getByRole('banner').getByRole('button', { name: 'ES' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();

  await page.goto('/dashboard/integrity');
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Integridad' }),
  ).toBeVisible();
});
