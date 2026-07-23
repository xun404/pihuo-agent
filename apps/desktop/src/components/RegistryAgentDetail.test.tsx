import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { I18nProvider } from '../i18n/I18nProvider.js'
import type { WorkerRegistryOption } from '../lib/worker-registry.js'
import {
  digestsEqual,
  formatDigestShort,
  RegistryAgentDetail,
} from './RegistryAgentDetail.js'

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

function render(
  distribution: 'npx' | 'binary',
  selected = option,
  observedSha256?: string,
): string {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="en">
      <RegistryAgentDetail
        option={selected}
        distribution={distribution}
        trustNoSha={false}
        observedSha256={observedSha256}
        onDistributionChange={() => {}}
        onTrustNoShaChange={() => {}}
      />
    </I18nProvider>,
  )
}

describe('RegistryAgentDetail digest helpers', () => {
  it('shortens long digests and compares with or without sha256: prefix', () => {
    const long = 'a'.repeat(64)
    assert.equal(formatDigestShort(long), `${'a'.repeat(10)}…${'a'.repeat(8)}`)
    assert.equal(formatDigestShort(`sha256:${long}`), `${'a'.repeat(10)}…${'a'.repeat(8)}`)
    assert.equal(digestsEqual(`sha256:${long}`, long), true)
    assert.equal(digestsEqual(long, 'b'.repeat(64)), false)
    assert.equal(digestsEqual(long, undefined), null)
  })
})

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
      'Integrity',
      'Manifest',
      `${'a'.repeat(10)}…${'a'.repeat(8)}`,
      'After preparation',
      'not a security sandbox',
    ])
      assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.doesNotMatch(html, /untrusted\.example\/icon\.svg/u)
    assert.doesNotMatch(html, /dangerouslySetInnerHTML/u)
  })

  it('hides binary artifact SHA rows for npx and only keeps manifest integrity', () => {
    const npxHtml = render('npx')
    assert.match(npxHtml, /Integrity/u)
    assert.match(npxHtml, /Manifest/u)
    assert.match(npxHtml, /Node\.js and npx/u)
    assert.doesNotMatch(npxHtml, /Declared SHA-256/u)
    assert.doesNotMatch(npxHtml, /Observed SHA-256/u)
    assert.doesNotMatch(npxHtml, /After preparation/u)
    assert.doesNotMatch(npxHtml, /Trust this exact manifest/u)
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

    assert.match(binaryHtml, /No declared SHA-256/u)
    assert.match(binaryHtml, /Not declared/u)
    assert.match(binaryHtml, /Trust this exact manifest/u)
  })

  it('shows match / mismatch when observed SHA is present for binary', () => {
    const declared = 'a'.repeat(64)
    const matchHtml = render('binary', option, declared)
    assert.match(matchHtml, /Match/u)
    assert.doesNotMatch(matchHtml, /Mismatch/u)

    const mismatchHtml = render('binary', option, 'c'.repeat(64))
    assert.match(mismatchHtml, /Mismatch/u)
  })
})
