import type { Channel, MessageStatus, Tenant } from '../../shared/types.ts';

export interface OutboundMessage {
  messageId: string;
  channel: Channel;
  to: string;
  subject: string | null;
  text: string;
  html: string | null;
  tenant: Tenant;
}

export interface SendResult {
  status: 'sent' | 'failed';
  providerMessageId: string | null;
  error: string | null;
  detail: string;
}

/** Called when a provider learns a message's final fate (delivered, failed…). */
export type StatusSink = (providerMessageId: string, status: MessageStatus, detail: string, error?: string | null) => void;

/**
 * A delivery channel. To add a provider (e.g. SendGrid, Telnyx, Postmark),
 * implement this interface and register it in providers/index.ts.
 */
export interface NotificationProvider {
  readonly name: string;
  readonly channel: Channel;
  readonly live: boolean;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Optional: follow up on delivery status (polling or simulation). */
  track?(providerMessageId: string, message: OutboundMessage, sink: StatusSink): void;
}
