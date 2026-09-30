import { expect, test } from '@playwright/test'
import { launchApp, type Harness } from './helpers'

test.describe('drag and drop tabs', () => {
  let h: Harness
  test.beforeEach(async () => {
    h = await launchApp()
  })
  test.afterEach(async () => {
    await h.cleanup()
  })

  const ids = (strip: ReturnType<Harness['ui']['getByTestId']>) =>
    strip.getByTestId('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id')))

  test('dragging a tab onto another one reorders the strip', async () => {
    const { ui } = h
    await ui.getByTestId('new-tab').click()
    await ui.getByTestId('new-tab').click()
    const strip = ui.getByTestId('tab-strip-0')
    const tabs = strip.getByTestId('tab')
    await expect(tabs).toHaveCount(3)
    const [first, second, third] = await ids(strip)

    // Drop on the right half of the last tab: the first tab goes to the end.
    const last = await tabs.nth(2).boundingBox()
    await tabs.nth(0).dragTo(tabs.nth(2), { targetPosition: { x: last!.width - 4, y: last!.height / 2 } })
    await expect.poll(() => ids(strip)).toEqual([second, third, first])

    // Drop on the left half of the first tab: back to the front.
    await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: last!.height / 2 } })
    await expect.poll(() => ids(strip)).toEqual([first, second, third])
  })

  test('dragging a tab into the other column moves it there', async () => {
    const { ui } = h
    await ui.getByTestId('new-tab').click()
    await ui.getByTestId('split-button').click()
    const left = ui.getByTestId('tab-strip-0')
    const right = ui.getByTestId('tab-strip-1')
    await expect(left.getByTestId('tab')).toHaveCount(2)
    await expect(right.getByTestId('tab')).toHaveCount(1)
    const [a, b] = await ids(left)
    const [c] = await ids(right)

    await left.getByTestId('tab').nth(0).dragTo(right.getByTestId('tab').nth(0), { targetPosition: { x: 4, y: 10 } })
    await expect.poll(() => ids(left)).toEqual([b])
    await expect.poll(() => ids(right)).toEqual([a, c])
    await expect(right.getByTestId('tab').nth(0)).toHaveAttribute('data-active', 'true')

    // Dragging a column's last tab away ends split view.
    await left.getByTestId('tab').nth(0).dragTo(right.getByTestId('tab').nth(1), { targetPosition: { x: 4, y: 10 } })
    await expect(ui.getByTestId('tab-strip-1')).toHaveCount(0)
    await expect.poll(() => ids(left)).toEqual([a, b, c])
  })
})
