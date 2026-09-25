// Exercise the visible custom listbox rather than the hidden native form fallback.
export async function chooseWorkspaceOption(page, label, value) {
  if (label === 'Album section') {
    await page.getByRole('group', { name: label, exact: true }).locator(`button[data-value="${value}"]`).click();
    return;
  }
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.locator('[role="option"]').and(page.locator(`[data-value="${value}"]`)).click();
}
