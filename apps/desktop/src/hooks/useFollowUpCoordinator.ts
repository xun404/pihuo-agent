import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatRunAbortIntent, FollowUpRequestMeta } from '@swarmdesk-agent/shared'
import { abortChatRun, getChatRunStatus } from '../lib/chat-run-api'
import {
  FollowUpCoordinator,
  type FollowUpCoordinatorSnapshot,
  type FollowUpIntent,
} from '../lib/follow-up-coordinator'
import {
  addFollowUpOutboxItem,
  listFollowUpOutbox,
  moveFollowUpOutboxItemToFront,
  removeFollowUpOutboxItem,
  subscribeFollowUpOutbox,
  updateFollowUpOutboxItem,
  type FollowUpOutboxItem,
} from '../lib/follow-up-outbox'
import type { FollowUpBehavior } from '../lib/follow-up-behavior'

type SendLeaderMessage = (input: {
  id: string
  text: string
  followUp: FollowUpRequestMeta
}) => Promise<void>

export type UseFollowUpCoordinatorOptions = {
  threadId: string
  historyReady: boolean
  modelReady: boolean
  send: SendLeaderMessage
  stopLocal: () => void
  resume: () => Promise<void>
  refreshHistory: () => Promise<void>
  onModelRequired: () => void
  onCapacityReached?: () => void
  coordinatorRef?: React.MutableRefObject<FollowUpCoordinator | null>
}

const INITIAL_SNAPSHOT: FollowUpCoordinatorSnapshot = {
  phase: 'bootstrapping',
  bootstrapped: false,
  serverStatus: null,
  activeClientRunId: null,
  retryAt: null,
}

function createDeliveryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const hex = () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  // Electron always has crypto.randomUUID, but preserve the wire contract for
  // constrained test/webview environments too.
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`
}

/**
 * React bridge for the pure per-thread coordinator. All mutable callbacks are
 * read through optionsRef, so model changes and setMessages replacements do
 * not destroy an active run lease or its retry timer.
 */
export function useFollowUpCoordinator(options: UseFollowUpCoordinatorOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const ownedRef = useRef<FollowUpCoordinator | null>(null)
  const exposedRef = options.coordinatorRef ?? ownedRef
  const [snapshot, setSnapshot] = useState<FollowUpCoordinatorSnapshot>(INITIAL_SNAPSHOT)
  const [outbox, setOutbox] = useState<FollowUpOutboxItem[]>(() =>
    listFollowUpOutbox(options.threadId),
  )

  useEffect(() => {
    setOutbox(listFollowUpOutbox(options.threadId))
    return subscribeFollowUpOutbox(options.threadId, () => {
      setOutbox(listFollowUpOutbox(options.threadId))
    })
  }, [options.threadId])

  useEffect(() => {
    if (!options.historyReady) {
      setSnapshot(INITIAL_SNAPSHOT)
      return
    }
    const threadId = options.threadId
    const coordinator = new FollowUpCoordinator({
      threadId,
      now: () => Date.now(),
      createId: createDeliveryId,
      hasModel: () => optionsRef.current.modelReady,
      getOutbox: () => listFollowUpOutbox(threadId),
      addOutbox: (item) => addFollowUpOutboxItem(threadId, item),
      updateOutbox: (deliveryId, patch) => updateFollowUpOutboxItem(threadId, deliveryId, patch),
      removeOutbox: (deliveryId) => removeFollowUpOutboxItem(threadId, deliveryId),
      moveToFront: (deliveryId) => moveFollowUpOutboxItemToFront(threadId, deliveryId),
      getRunStatus: (clientRunId) =>
        getChatRunStatus(threadId, { clientRunId: clientRunId || undefined }),
      requestAbort: (clientRunId, intent: ChatRunAbortIntent) =>
        abortChatRun(threadId, clientRunId, intent),
      send: (input) => optionsRef.current.send(input),
      stopLocal: () => optionsRef.current.stopLocal(),
      resume: async () => optionsRef.current.resume(),
      refreshHistory: () => optionsRef.current.refreshHistory(),
      onModelRequired: () => optionsRef.current.onModelRequired(),
      onCapacityReached: () => optionsRef.current.onCapacityReached?.(),
      onChange: (next) => setSnapshot(next),
      setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimer: (timer) => clearTimeout(timer),
    })
    exposedRef.current = coordinator
    void coordinator.bootstrap()
    return () => {
      coordinator.dispose()
      if (exposedRef.current === coordinator) exposedRef.current = null
    }
  }, [exposedRef, options.historyReady, options.threadId])

  useEffect(() => {
    if (options.modelReady) {
      void exposedRef.current?.reconcileAndDispatch()
    }
  }, [exposedRef, options.modelReady])

  const submit = useCallback(
    (
      text: string,
      input: {
        behavior: FollowUpBehavior
        preferSteer: boolean
        source?: FollowUpRequestMeta['source']
      },
    ): FollowUpIntent => {
      const coordinator = exposedRef.current
      if (!coordinator) return 'wait'
      return coordinator.submit(text, input)
    },
    [exposedRef],
  )

  const sendNow = useCallback(
    (deliveryId: string) => {
      exposedRef.current?.sendNow(deliveryId)
    },
    [exposedRef],
  )

  const stop = useCallback(
    (intent: ChatRunAbortIntent = 'stop') => exposedRef.current?.stop(intent),
    [exposedRef],
  )

  const remove = useCallback(
    (deliveryId: string) => removeFollowUpOutboxItem(options.threadId, deliveryId),
    [options.threadId],
  )

  return {
    snapshot,
    outbox,
    submit,
    sendNow,
    stop,
    remove,
    coordinator: exposedRef.current,
  }
}
