// Exercise the visible custom listbox rather than the hidden native form fallback.
export async function chooseWorkspaceOption(page, label, value) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.locator('[role="option"]').and(page.locator(`[data-value="${value}"]`)).click();
}
