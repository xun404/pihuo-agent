import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { I18nProvider } from '../i18n/I18nProvider.js'
import type { WorkerRegistryOption } from '../lib/worker-registry.js'
import { WorkerRegistryCombobox } from './WorkerRegistryCombobox.js'

const option: WorkerRegistryOption = {
  id: 'fixture-agent',
  name: 'Fixture Agent',
  version: '1.2.3',
  description: 'Fixture',
  icon: 'https://untrusted.example/agent.svg',
  distribution: 'npx',
  distributions: ['npx', 'uvx', 'binary'],
  distributionDetails: [],
  command: 'npx',
  args: [],
  env: {},
  requiresLocalInstall: false,
  manifestDigest: `sha256:${'a'.repeat(64)}`,
  availability: 'available',
  platformSupported: true,
  platformTarget: 'linux-x86_64',
  relatedWorkers: [
    {
      id: 'worker-fixture',
      name: 'Fixture Agent',
      readiness: { status: 'auth_required' },
      installationId: 'inst_fixture',
      registryVersion: '1.2.3',
    },
  ],
}

describe('WorkerRegistryCombobox', () => {
  it('keeps one searchable combobox and shows full platform/distribution/install/auth summaries', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRegistryCombobox
          options={[option]}
          selectedId={null}
          loading={false}
          error={null}
          placeholder="Search agents"
          loadingLabel="Loading"
          emptyLabel="Empty"
          localInstallLabel="Local install"
          defaultOpen
          onSelect={() => {}}
        />
      </I18nProvider>,
    )

    assert.equal((html.match(/role="combobox"/gu) ?? []).length, 1)
    assert.match(html, /role="listbox"/u)
    assert.match(html, /linux-x86_64/u)
    assert.match(html, /npx \/ uvx \/ binary/u)
    assert.match(html, /Installed/u)
    assert.match(html, /Authentication required/u)
    assert.doesNotMatch(html, /untrusted\.example\/agent\.svg/u)
  })
})
