import assert from 'node:assert/strict'
import test from 'node:test'
import { ListVideo, Toolbox } from 'lucide-react'

import { getToolIcon } from './Icons.js'

test('maps the requested Router session tools to their Lucide icons', () => {
  assert.equal(getToolIcon('listJobsTool'), Toolbox)
  assert.equal(getToolIcon('getActiveContextTool'), ListVideo)
})
