import assert from 'node:assert/strict'
import test from 'node:test'
import { scrollOptionIntoView } from './SettingsSelect'

type Rect = { top: number; bottom: number }
type ScrollHandler = (options?: boolean | ScrollIntoViewOptions) => void

function fakeElement(rect: Rect, onScroll: ScrollHandler): HTMLElement {
  return {
    getBoundingClientRect: () => ({ ...rect }),
    scrollIntoView: onScroll,
  } as unknown as HTMLElement
}

test('scrollOptionIntoView leaves visible options in place', () => {
  let scrolls = 0
  const menu = fakeElement({ top: 100, bottom: 300 }, () => {})
  const option = fakeElement({ top: 120, bottom: 280 }, () => {
    scrolls += 1
  })

  assert.equal(scrollOptionIntoView(menu, option), false)
  assert.equal(scrolls, 0)
})

test('scrollOptionIntoView uses nearest scrolling for options outside the menu', () => {
  const calls: Array<boolean | ScrollIntoViewOptions | undefined> = []
  const menu = fakeElement({ top: 100, bottom: 300 }, () => {})
  const above = fakeElement({ top: 60, bottom: 120 }, (options) => calls.push(options))
  const below = fakeElement({ top: 280, bottom: 340 }, (options) => calls.push(options))

  assert.equal(scrollOptionIntoView(menu, above), true)
  assert.equal(scrollOptionIntoView(menu, below), true)
  assert.deepEqual(calls, [{ block: 'nearest' }, { block: 'nearest' }])
})

test('scrollOptionIntoView tolerates missing portal elements', () => {
  assert.equal(scrollOptionIntoView(null, null), false)
})
