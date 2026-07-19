import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { I18nProvider } from '../i18n/I18nProvider.js'
import type { WorkerRegistryOption } from '../lib/worker-registry.js'
import { RegistryAgentDetail } from './RegistryAgentDetail.js'

const option: WorkerRegistryOption = {
  id: 'fixture-agent',
  name: 'Fixture Agent',
  version: '2.3.4',
  description: 'Fixture description',
  icon: 'https://untrusted.example/icon.svg',
  distribution: 'binary',
  distributions: ['npx', 'binary'],
  command: 'fixture-agent',
  args: ['--acp'],
  env: {},
  requiresLocalInstall: true,
  manifestDigest: `sha256:${'b'.repeat(64)}`,
  availability: 'available',
  platformSupported: true,
  platformTarget: 'darwin-aarch64',
  repository: 'https://github.com/example/fixture-agent',
  website: 'https://example.com/fixture-agent',
  authors: [{ name: 'Fixture Author', url: 'https://example.com/author' }],
  license: 'Apache-2.0',
  distributionDetails: [
    { kind: 'npx', package: '@example/fixture-agent@2.3.4', args: ['--acp'], env: {} },
    {
      kind: 'binary',
      targets: [
        {
          target: 'darwin-aarch64',
          archiveUrl: 'https://downloads.example.com/fixture-agent.tar.gz',
          sha256: 'a'.repeat(64),
          cmd: 'fixture-agent',
          args: ['--acp'],
          env: {},
        },
      ],
    },
  ],
}

function render(distribution: 'npx' | 'binary', selected = option): string {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="en">
      <RegistryAgentDetail
        option={selected}
        distribution={distribution}
        trustNoSha={false}
        onDistributionChange={() => {}}
        onTrustNoShaChange={() => {}}
      />
    </I18nProvider>,
  )
}

describe('RegistryAgentDetail', () => {
  it('shows trusted identity, distribution, domain, command and digest facts without remote SVG', () => {
    const html = render('binary')

    for (const expected of [
      'Fixture Agent',
      'fixture-agent',
      '2.3.4',
      'Fixture Author',
      'Apache-2.0',
      'github.com/example/fixture-agent',
      'downloads.example.com',
      'fixture-agent --acp',
      'aaaaaaaaaaaaaaaa',
      'Available after preparation',
      'not a security sandbox',
    ])
      assert.match(html, new RegExp(expected, 'u'))
    assert.doesNotMatch(html, /untrusted\.example\/icon\.svg/u)
    assert.doesNotMatch(html, /dangerouslySetInnerHTML/u)
  })

  it('shows runner prerequisite and a trust confirmation only for a selected binary without sha', () => {
    const withoutSha: WorkerRegistryOption = {
      ...option,
      distributionDetails: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://downloads.example.com/fixture-agent',
              cmd: 'fixture-agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      distributions: ['binary'],
    }
    const binaryHtml = render('binary', withoutSha)
    const npxHtml = render('npx')

    assert.match(binaryHtml, /No declared SHA-256/u)
    assert.match(binaryHtml, /Trust this exact manifest/u)
    assert.match(npxHtml, /Node\.js and npx/u)
    assert.doesNotMatch(npxHtml, /Trust this exact manifest/u)
  })
})
