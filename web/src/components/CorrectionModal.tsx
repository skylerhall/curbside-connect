import { useEffect, useState } from 'react';
import type { Campaign } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { NotifyFlow } from './NotifyFlow.tsx';
import { ErrorNote, Field, Modal, Spinner } from './ui.tsx';

interface Draft {
  campaign: Campaign;
  message: string;
  undoLabel: string | null;
  recipients: number;
}

/**
 * Follow-up for a notification that went out by mistake: goes only to the
 * people who received it, on the same channels, and can undo the change.
 */
export function CorrectionModal({ campaignId, onClose, onSent, onChanged }: { campaignId: string; onClose: () => void; onSent?: (c: Campaign) => void; onChanged?: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [debounced, setDebounced] = useState('');
  const [undo, setUndo] = useState(true);

  useEffect(() => {
    api<Draft>(`/campaigns/${campaignId}/correction-draft`)
      .then((d) => {
        setDraft(d);
        setMessage(d.message);
        setDebounced(d.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [campaignId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(message), 400);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <Modal open onClose={onClose} wide title="Send a correction" subtitle={draft ? `Original: ${draft.campaign.title}` : undefined}>
      {error ? (
        <ErrorNote error={error} />
      ) : !draft ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Texts and emails can’t be unsent, but this reaches the <b className="text-ink">{draft.recipients} customer{draft.recipients === 1 ? '' : 's'}</b> who received the original, on the same channels, and nobody else.
          </p>
          <Field label="What should customers know?" hint={`${message.length} characters. Keep it under about 100 so the text fits in one message.`}>
            <textarea className="min-h-20 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-brand/50 focus:ring-3 focus:ring-brand/15" maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {draft.undoLabel && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={undo} onChange={(e) => setUndo(e.target.checked)} />
              <span>{draft.undoLabel}</span>
            </label>
          )}
          <NotifyFlow
            request={{ kind: 'correction', campaignId, message: debounced, undoChange: Boolean(draft.undoLabel) && undo }}
            disabledReason={debounced.trim() ? null : 'Write the correction message to preview it.'}
            sendLabel="Send correction:"
            emptyText="Nobody received the original, so there’s nothing to correct."
            onSent={(c) => {
              onChanged?.();
              onSent?.(c);
            }}
          />
        </div>
      )}
    </Modal>
  );
}
