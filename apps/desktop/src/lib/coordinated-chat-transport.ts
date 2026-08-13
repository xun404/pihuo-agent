import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

export type DeliveryTransportMeta = {
  deliveryId: string
  clientRunId: string
}

export type DeliveryTransportObserver = {
  accepted: (meta: DeliveryTransportMeta) => void
  initialFailure: (meta: DeliveryTransportMeta, error: unknown) => void
}

function deliveryMetaFromBody(body: object | undefined): DeliveryTransportMeta | undefined {
  if (!body || typeof body !== 'object') return undefined
  const followUp = (body as { followUp?: unknown }).followUp
  if (!followUp || typeof followUp !== 'object') return undefined
  const record = followUp as { deliveryId?: unknown; clientRunId?: unknown }
  if (typeof record.deliveryId !== 'string' || typeof record.clientRunId !== 'string')
    return undefined
  return { deliveryId: record.deliveryId, clientRunId: record.clientRunId }
}

/**
 * The only reliable browser acknowledgement boundary for AI SDK v6:
 * DefaultChatTransport resolves after a valid HTTP response body is open.
 * AbstractChat later swallows stream/transport errors into its local status,
 * so business code must not use sendMessage's Promise as an acknowledgement.
 */
export class CoordinatedChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  constructor(
    private readonly inner: ChatTransport<UI_MESSAGE>,
    private readonly observer: DeliveryTransportObserver,
  ) {}

  async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const meta = deliveryMetaFromBody(options.body)
    try {
      const stream = await this.inner.sendMessages(options)
      if (meta) this.observer.accepted(meta)
      return stream
    } catch (error) {
      if (meta) this.observer.initialFailure(meta, error)
      throw error
    }
  }

  reconnectToStream(
    options: Parameters<ChatTransport<UI_MESSAGE>['reconnectToStream']>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return this.inner.reconnectToStream(options)
  }
}
