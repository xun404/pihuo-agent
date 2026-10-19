import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import type { TeamMember } from '@pihuo-agent/shared'
import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  teamMentionCandidates,
  type MentionCandidate,
} from '../lib/im-mentions'
import { wrapQuoteChrome, type UserQuoteChrome } from '../lib/user-message-display'

export function useImComposer(args: {
  teamMembers: readonly TeamMember[]
  workers?: readonly { id: string; name: string }[]
  leaderName: string
}) {
  const [quote, setQuote] = useState<UserQuoteChrome | null>(null)
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)

  const candidates = useMemo<MentionCandidate[]>(
    () => teamMentionCandidates(args.leaderName, args.teamMembers, args.workers),
    [args.leaderName, args.teamMembers, args.workers],
  )

  const mentionNames = useMemo(() => candidates.map((item) => item.name), [candidates])

  const queryAt = useCallback(
    (text: string, position = caret) => mentionQueryAt(text, position),
    [caret],
  )

  const visibleCandidates = useCallback(
    (text: string, position = caret) => {
      const found = mentionQueryAt(text, position)
      if (!found) return []
      return filterMentionCandidates(candidates, found.query)
    },
    [candidates, caret],
  )

  const clearQuote = useCallback(() => setQuote(null), [])

  const applyChrome = useCallback(
    (text: string) => (quote ? wrapQuoteChrome(quote, text) : text),
    [quote],
  )

  const pickMention = useCallback(
    (text: string, name: string, position = caret) => {
      const next = insertMention(text, position, name)
      setCaret(next.caret)
      setActiveIndex(0)
      return next
    },
    [caret],
  )

  const onCaret = useCallback((position: number) => {
    setCaret(position)
    setActiveIndex(0)
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, text: string, setText: (value: string) => void) => {
      const visible = visibleCandidates(text, event.currentTarget.selectionStart ?? caret)
      const query = mentionQueryAt(text, event.currentTarget.selectionStart ?? caret)
      if (!query || visible.length === 0) return false
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % visible.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + visible.length) % visible.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const pick = visible[activeIndex] ?? visible[0]
        if (pick) {
          const next = insertMention(text, event.currentTarget.selectionStart ?? caret, pick.name)
          setCaret(next.caret)
          setActiveIndex(0)
          setText(next.text)
        }
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setActiveIndex(0)
        return true
      }
      return false
    },
    [activeIndex, caret, visibleCandidates],
  )

  return {
    quote,
    setQuote,
    clearQuote,
    applyChrome,
    mentionNames,
    candidates,
    visibleCandidates,
    queryAt,
    pickMention,
    caret,
    onCaret,
    activeIndex,
    setActiveIndex,
    onKeyDown,
  }
}
