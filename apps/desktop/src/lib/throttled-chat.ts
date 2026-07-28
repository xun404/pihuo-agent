import { Chat } from '@ai-sdk/react'
import type { ChatInit, UIMessage } from 'ai'

/**
 * Workaround for vercel/ai#6166 ("Maximum update depth exceeded" under bursty
 * streams; unfixed upstream as of @ai-sdk/react 4.0.43 — PR #17893 pending).
 *
 * The stock ReactChatState swaps the `messages` array on EVERY stream chunk.
 * `useChat`'s `getSnapshot` returns that same array, so React's tearing guard
 * (`checkIfSnapshotChanged` → `forceStoreRerender`) force-rerenders per chunk,
 * bypassing `experimental_throttle` (which only throttles the notify callback)
 * and blowing past React's nested-update limit when chunks outpace renders.
 *
 * ThrottledChat applies the PR #17893 idea through the public extension point:
 * - `this.state.messages` stays the live buffer, mutated per chunk — all
 *   AbstractChat streaming logic (push/replace/lastMessage) keeps working.
 * - The public `messages` getter returns a *published snapshot* whose identity
 *   only changes at publish points (leading + trailing, one window apart), so
 *   React sees a stable reference between publishes.
 * - The React notification itself is ALWAYS deferred to a macrotask. A
 *   synchronous notify can land inside a render/commit (nested-update count++);
 *   under heavy load (slow renders, dense chunks) every render then gets torn
 *   by the next publish and the counter climbs to 50 → the exact crash this
 *   class exists to prevent (observed live: forceStoreRerender throwing from
 *   within a leading-edge publish). A macrotask can never interleave React's
 *   synchronous render/commit/passive-flush work, so the deferred
 *   forceStoreRerender is a plain preemption, not a nested update.
 */
export class ThrottledChat<UI_MESSAGE extends UIMessage = UIMessage> extends Chat<UI_MESSAGE> {
  #snapshot: UI_MESSAGE[]
  readonly #windowMs: number
  #timer: ReturnType<typeof setTimeout> | null = null
  #lastPublishAt = 0
  #reactCallbacks = new Set<() => void>()
  #innerSubscribed = false

  constructor(init: ChatInit<UI_MESSAGE>, opts?: { windowMs?: number }) {
    super(init)
    this.#windowMs = opts?.windowMs ?? 100
    this.#snapshot = this.state.messages
    const innerRegister = this['~registerMessagesCallback']
    this['~registerMessagesCallback'] = (onChange) => {
      this.#reactCallbacks.add(onChange)
      // One unthrottled inner subscription drives the publish scheduler; React
      // subscribers are only notified at publish points.
      if (!this.#innerSubscribed) {
        this.#innerSubscribed = true
        innerRegister(() => this.#schedulePublish(), undefined)
      }
      return () => {
        this.#reactCallbacks.delete(onChange)
        if (this.#reactCallbacks.size === 0 && this.#timer) {
          clearTimeout(this.#timer)
          this.#timer = null
        }
      }
    }
  }

  /** What React (and only React) reads — stable between publish points. */
  override get messages(): UI_MESSAGE[] {
    return this.#snapshot
  }

  override set messages(messages: UI_MESSAGE[]) {
    // Explicit setMessages swaps the snapshot synchronously (history load,
    // compress reload) but still notifies via the deferred scheduler — the
    // React callback must never run inside a render/commit.
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    this.state.messages = messages
    this.#snapshot = messages
    this.#scheduleNotify()
  }

  #schedulePublish(): void {
    const now = Date.now()
    const elapsed = now - this.#lastPublishAt
    const delay = elapsed >= this.#windowMs ? 0 : this.#windowMs - elapsed
    this.#scheduleNotify(delay)
  }

  /** Defer the swap+notify to a macrotask; coalesce repeats within the delay. */
  #scheduleNotify(delay = 0): void {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#publish()
    }, delay)
  }

  #publish(): void {
    this.#lastPublishAt = Date.now()
    this.#snapshot = this.state.messages
    for (const cb of this.#reactCallbacks) cb()
  }
}
