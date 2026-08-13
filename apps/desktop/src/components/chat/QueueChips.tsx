import { IconArrowUp, IconMove, IconTrash } from '../Icons'
import { useI18n } from '../../i18n/I18nProvider'
import type { FollowUpOutboxItem } from '../../lib/follow-up-outbox'

type Props = {
  items: FollowUpOutboxItem[]
  phase:
    | 'bootstrapping'
    | 'ready'
    | 'dispatching'
    | 'observing'
    | 'terminating'
    | 'retry_wait'
    | 'blocked_model'
  onRemove: (deliveryId: string) => void
  onReturnToInput: (deliveryId: string) => void
  onSendNow: (deliveryId: string) => void
}

function statusText(
  item: FollowUpOutboxItem,
  phase: Props['phase'],
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  if (item.state === 'retry_wait') return t('chat.followUpRetrying')
  if (item.state === 'unknown') return t('chat.followUpReconciling')
  if (phase === 'blocked_model') return t('chat.followUpBlockedModel')
  if (phase === 'terminating') return t('chat.followUpWaiting')
  if (item.state === 'dispatching') return t('chat.followUpWaiting')
  return null
}

/** Compact, accessible FIFO outbox view above the composer. */
export function QueueChips({ items, phase, onRemove, onReturnToInput, onSendNow }: Props) {
  const { t } = useI18n()
  if (items.length === 0) return null
  return (
    <div className="follow-up-queue" aria-label={t('chat.followUpQueue')}>
      <span className="follow-up-queue-label">{t('chat.followUpQueue')}</span>
      <div className="follow-up-queue-list">
        {items.map((item, index) => {
          const locked = item.state === 'dispatching'
          const state = statusText(item, phase, t)
          return (
            <div className="follow-up-queue-chip" key={item.deliveryId}>
              <span className="follow-up-queue-index" aria-hidden>
                {index + 1}
              </span>
              <span className="follow-up-queue-content" title={item.content}>
                {item.content}
              </span>
              {state && <span className="follow-up-queue-state">{state}</span>}
              <button
                type="button"
                className="follow-up-queue-action"
                onClick={() => onReturnToInput(item.deliveryId)}
                disabled={locked}
                title={t('chat.followUpReturnToInput')}
                aria-label={t('chat.followUpReturnToInput')}
              >
                <IconMove size={13} />
              </button>
              <button
                type="button"
                className="follow-up-queue-action"
                onClick={() => onSendNow(item.deliveryId)}
                disabled={locked}
                title={t('chat.followUpSendNow')}
                aria-label={t('chat.followUpSendNow')}
              >
                <IconArrowUp size={13} />
              </button>
              <button
                type="button"
                className="follow-up-queue-action is-remove"
                onClick={() => onRemove(item.deliveryId)}
                disabled={locked}
                title={t('chat.followUpRemove')}
                aria-label={t('chat.followUpRemove')}
              >
                <IconTrash size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
