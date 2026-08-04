import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n/I18nProvider.js'
import {
  parseWorkerTimeoutMinutes,
  WorkerTimeoutSettingsEditor,
} from './WorkerTimeoutSettingsEditor.js'

const defaults = {
  jobTimeoutMs: 600_000,
  queueTimeoutMs: 600_000,
}

describe('WorkerTimeoutSettingsEditor', () => {
  it('renders leader max steps and the two Worker timeout values in minutes', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerTimeoutSettingsEditor
          value={defaults}
          saving={false}
          onSave={async () => {}}
          leaderMaxSteps={500}
          onSaveLeaderMaxSteps={async () => {}}
        />
      </I18nProvider>,
    )

    assert.match(html, /Worker execution settings/u)
    assert.match(html, /settings-card-head/u)
    assert.match(html, /aria-label="Leader step budget"[^>]*value="500"/u)
    assert.match(html, /timeout-duration-field/u)
    assert.match(html, />steps</u)
    assert.match(html, /aria-label="Worker task timeout"[^>]*value="10"/u)
    assert.doesNotMatch(html, /Approval timeout/u)
    assert.match(html, /aria-label="Worker queue timeout"[^>]*value="10"/u)
    assert.match(html, /timeout-duration-unit/u)
    assert.match(html, />min</u)
    assert.doesNotMatch(html, /settings-save-btn/u)
    assert.doesNotMatch(html, /settings-actions-row/u)
  })

  it('converts valid minutes to milliseconds', () => {
    assert.deepEqual(parseWorkerTimeoutMinutes({ job: '10', queue: '20' }), {
      ok: true,
      value: {
        jobTimeoutMs: 600_000,
        queueTimeoutMs: 1_200_000,
      },
    })
  })

  it('reports the first invalid or out-of-range field', () => {
    assert.deepEqual(parseWorkerTimeoutMinutes({ job: '0', queue: '10' }), {
      ok: false,
      field: 'job',
    })
    assert.deepEqual(parseWorkerTimeoutMinutes({ job: '10', queue: '121' }), {
      ok: false,
      field: 'queue',
    })
  })
})
