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
  it('keeps one searchable combobox with single-line option meta and no caret', () => {
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
    assert.doesNotMatch(html, /worker-registry-caret|worker-registry-toggle/u)
    assert.doesNotMatch(html, /worker-registry-clear/u)
    assert.match(html, /worker-registry-option-meta/u)
    // wireframe-v5: name · id · "version · dist · install · readiness" on one row
    assert.match(html, /1\.2\.3 · npx \/ uvx \/ binary · Installed · Authentication required/u)
    assert.doesNotMatch(html, /untrusted\.example\/agent\.svg/u)
  })

  it('shows a clear control when the search query is non-empty', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRegistryCombobox
          options={[option]}
          selectedId={option.id}
          loading={false}
          error={null}
          placeholder="Search agents"
          loadingLabel="Loading"
          emptyLabel="Empty"
          localInstallLabel="Local install"
          onSelect={() => {}}
        />
      </I18nProvider>,
    )

    // selected option syncs query to option.name → clear button visible
    assert.match(html, /worker-registry-clear/u)
    assert.match(html, /aria-label="Clear"/u)
  })

  it('renders every option without a result count header', () => {
    const options = Array.from({ length: 38 }, (_, index) => ({
      ...option,
      id: `fixture-agent-${index}`,
      name: `Fixture Agent ${index}`,
    }))
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRegistryCombobox
          options={options}
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

    assert.equal((html.match(/role="option"/gu) ?? []).length, 38)
    assert.doesNotMatch(html, /worker-registry-result-count/u)
    assert.doesNotMatch(html, /38 \/ 38/u)
  })
})
