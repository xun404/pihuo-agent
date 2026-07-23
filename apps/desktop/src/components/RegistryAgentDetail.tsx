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

/** Strip optional `sha256:` prefix for compare/display. */
export function digestBare(value: string): string {
  return value.trim().replace(/^sha256:/iu, '')
}

/**
 * Compact digest: first 10 + last 8 hex chars (or full if short).
 * Full value stays on `title` for hover / accessibility.
 */
export function formatDigestShort(value: string): string {
  const bare = digestBare(value)
  if (bare.length <= 22) return bare
  return `${bare.slice(0, 10)}…${bare.slice(-8)}`
}

export function digestsEqual(a: string | undefined, b: string | undefined): boolean | null {
  if (!a?.trim() || !b?.trim()) return null
  return digestBare(a).toLowerCase() === digestBare(b).toLowerCase()
}

function DigestValue({ value }: { value: string }) {
  return (
    <code className="registry-digest mono" title={value}>
      {formatDigestShort(value)}
    </code>
  )
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
  const isBinary = props.distribution === 'binary'
  const binaryTarget =
    detail?.kind === 'binary'
      ? detail.targets.find((target) => target.target === option.platformTarget)
      : undefined
  const declaredSha256 = binaryTarget?.sha256
  const missingSha = isBinary && Boolean(binaryTarget) && !declaredSha256
  const showArtifactIntegrity = isBinary && Boolean(binaryTarget)
  const shaMatch = digestsEqual(declaredSha256, props.observedSha256)
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
        <div className="registry-agent-detail-identity">
          <strong className="registry-agent-detail-name">{option.name}</strong>
          <span className="registry-agent-detail-id mono">
            {option.id}
            <span className="registry-agent-detail-sep" aria-hidden>
              ·
            </span>
            {option.version}
          </span>
        </div>
      </header>
      {option.description && (
        <p className="registry-agent-detail-desc">{option.description}</p>
      )}

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
      </dl>

      {/*
        Integrity digests:
        - Manifest: catalog pin (all distributions)
        - Declared / Observed SHA-256: binary archive only (npx/uvx have no artifact hash)
      */}
      <div className="registry-agent-integrity" aria-label={t('workers.registryDetailIntegrity')}>
        <div className="registry-agent-integrity-title">{t('workers.registryDetailIntegrity')}</div>
        <dl className="registry-agent-facts registry-agent-integrity-facts">
          <div>
            <dt>{t('workers.registryDetailManifest')}</dt>
            <dd>
              {option.manifestDigest ? (
                <DigestValue value={option.manifestDigest} />
              ) : (
                <span className="registry-digest-pending">—</span>
              )}
            </dd>
          </div>
          {showArtifactIntegrity && (
            <>
              <div>
                <dt>{t('workers.registryDetailDeclared')}</dt>
                <dd>
                  {declaredSha256 ? (
                    <DigestValue value={declaredSha256} />
                  ) : (
                    <span className="registry-digest-pending">
                      {t('workers.registryDeclaredMissing')}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('workers.registryDetailObserved')}</dt>
                <dd className="registry-digest-row">
                  {props.observedSha256 ? (
                    <DigestValue value={props.observedSha256} />
                  ) : (
                    <span className="registry-digest-pending">
                      {t('workers.registryObservedPending')}
                    </span>
                  )}
                  {shaMatch === true && (
                    <span className="registry-digest-badge is-match">
                      {t('workers.registryDigestMatch')}
                    </span>
                  )}
                  {shaMatch === false && (
                    <span className="registry-digest-badge is-mismatch">
                      {t('workers.registryDigestMismatch')}
                    </span>
                  )}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>

      <div className="registry-agent-dist-field">
        <label htmlFor="registry-agent-distribution">{t('workers.registryDetailDistribution')}</label>
        <select
          id="registry-agent-distribution"
          className="settings-input ui-font"
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
      </div>

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
      <div className="registry-agent-notices">
        <p>{t('workers.registryNetworkAuthNotice')}</p>
        <p>{t('workers.registrySandboxNotice')}</p>
      </div>
    </section>
  )
}
