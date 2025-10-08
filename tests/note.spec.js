const { test, expect } = require('@playwright/test');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const indexUrl = 'file://' + indexPath;

async function prepareBoard(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('fohowAuth', 'authenticated');
  });
  await page.goto(indexUrl);
  await page.click('#add-card-btn');
  const card = page.locator('.card').last();
  const noteButton = card.locator('.note-btn');
  return { card, noteButton };
}

test.describe('Заметки на карточке', () => {
  test('показывают индикатор выбранного цвета после изменения', async ({ page }) => {
    const { noteButton } = await prepareBoard(page);

    await noteButton.click();
    const textarea = page.locator('.note-textarea');
    await expect(textarea).toBeVisible();

    await page.locator('.clr-dot[data-color="#4caf50"]').click();
    await textarea.fill('Ежедневная активность');
    await page.click('.note-close-btn');

    await expect(noteButton).toHaveClass(/has-text/);
    await expect(noteButton).toHaveAttribute('data-note-color', '#4caf50');

    await noteButton.click();
    await expect(textarea).toHaveValue('Ежедневная активность');
    await expect(page.locator('.clr-dot[data-color="#4caf50"]').first()).toHaveClass(/active/);
  });

  test('удаление текста скрывает индикатор цвета', async ({ page }) => {
    const { noteButton } = await prepareBoard(page);

    await noteButton.click();
    const textarea = page.locator('.note-textarea');
    await textarea.fill('Разовая заметка');
    await page.locator('.clr-dot[data-color="#42a5f5"]').click();

    await expect(noteButton).toHaveClass(/has-text/);
    await expect(noteButton).toHaveAttribute('data-note-color', '#42a5f5');

    await textarea.fill('');
    await expect(noteButton).not.toHaveClass(/has-text/);
    await expect(noteButton).not.toHaveAttribute('data-note-color');
  });
});
