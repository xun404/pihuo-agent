import React from 'react'

import { useI18n } from '../i18n/I18nProvider'
import type { WorkerRegistryDistribution, WorkerRegistryOption } from '../lib/worker-registry'

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function shortDigest(value: string | undefined): string {
  if (!value) return '—'
  return value.length > 28 ? `${value.slice(0, 28)}…` : value
}

export function RegistryAgentDetail(props: {
  option: WorkerRegistryOption
  distribution: WorkerRegistryDistribution
  trustNoSha: boolean
  observedSha256?: string
  onDistributionChange: (distribution: WorkerRegistryDistribution) => void
  onTrustNoShaChange: (trusted: boolean) => void
}) {
  const { t } = useI18n()
  const { option } = props
  const detail = option.distributionDetails?.find(
    (candidate) => candidate.kind === props.distribution,
  )
  const binaryTarget =
    detail?.kind === 'binary'
      ? detail.targets.find((target) => target.target === option.platformTarget)
      : undefined
  const declaredSha256 = binaryTarget?.sha256
  const missingSha = detail?.kind === 'binary' && Boolean(binaryTarget) && !declaredSha256
  const source =
    detail?.kind === 'binary'
      ? safeHttpUrl(binaryTarget?.archiveUrl)?.replace(/^https?:\/\//u, '')
      : detail?.kind === 'npx'
        ? `registry.npmjs.org · ${detail.package}`
        : detail?.kind === 'uvx'
          ? `pypi.org · ${detail.package}`
          : '—'
  const command =
    detail?.kind === 'binary'
      ? binaryTarget
        ? [binaryTarget.cmd, ...binaryTarget.args].join(' ')
        : '—'
      : detail?.kind === 'npx' || detail?.kind === 'uvx'
        ? [detail.kind, detail.package, ...detail.args].join(' ')
        : [option.command, ...option.args].join(' ')
  const runner =
    props.distribution === 'npx'
      ? t('workers.registryRunnerNpx')
      : props.distribution === 'uvx'
        ? t('workers.registryRunnerUvx')
        : t('workers.registryRunnerBinary')
  const repository = safeHttpUrl(option.repository)
  const website = safeHttpUrl(option.website)

  return (
    <section className="registry-agent-detail" aria-label={t('workers.registryDetailTitle')}>
      <header className="registry-agent-detail-header">
        <span className="registry-agent-generic-icon" aria-hidden>
          ACP
        </span>
        <span>
          <strong>{option.name}</strong>
          <span className="mono">
            {option.id} · {option.version}
          </span>
        </span>
      </header>
      {option.description && <p className="settings-field-hint">{option.description}</p>}

      <dl className="registry-agent-facts">
        <div>
          <dt>{t('workers.registryDetailAuthors')}</dt>
          <dd>{option.authors?.map((author) => author.name).join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailLicense')}</dt>
          <dd>{option.license || '—'}</dd>
        </div>
        {repository && (
          <div>
            <dt>{t('workers.registryDetailRepository')}</dt>
            <dd>
              <a href={repository} target="_blank" rel="noreferrer">
                {repository.replace(/^https?:\/\//u, '')}
              </a>
            </dd>
          </div>
        )}
        {website && (
          <div>
            <dt>{t('workers.registryDetailWebsite')}</dt>
            <dd>
              <a href={website} target="_blank" rel="noreferrer">
                {website.replace(/^https?:\/\//u, '')}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <label className="settings-field">
        <span>{t('workers.registryDetailDistribution')}</span>
        <select
          className="field-select"
          value={props.distribution}
          onChange={(event) =>
            props.onDistributionChange(event.target.value as WorkerRegistryDistribution)
          }
        >
          {(option.distributions?.length ? option.distributions : [option.distribution]).map(
            (distribution) => (
              <option key={distribution} value={distribution}>
                {distribution}
              </option>
            ),
          )}
        </select>
      </label>

      <dl className="registry-agent-facts registry-agent-trust-facts">
        <div>
          <dt>{t('workers.registryDetailSource')}</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailCommand')}</dt>
          <dd className="mono">{command}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailRunner')}</dt>
          <dd>{runner}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailManifest')}</dt>
          <dd className="mono">{shortDigest(option.manifestDigest)}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailDeclared')}</dt>
          <dd className="mono">{shortDigest(declaredSha256)}</dd>
        </div>
        <div>
          <dt>{t('workers.registryDetailObserved')}</dt>
          <dd className="mono">
            {props.observedSha256
              ? shortDigest(props.observedSha256)
              : t('workers.registryObservedPending')}
          </dd>
        </div>
      </dl>

      {missingSha && (
        <div className="registry-agent-trust-warning">
          <strong>{t('workers.registryNoShaWarning')}</strong>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={props.trustNoSha}
              onChange={(event) => props.onTrustNoShaChange(event.target.checked)}
            />
            <span>{t('workers.registryTrustNoSha')}</span>
          </label>
        </div>
      )}
      <p className="settings-field-hint">{t('workers.registryNetworkAuthNotice')}</p>
      <p className="settings-field-hint">{t('workers.registrySandboxNotice')}</p>
    </section>
  )
}
