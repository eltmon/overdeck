import { useState, type ChangeEvent, type FormEvent } from 'react';

type AgentTellFormProps = {
  onSend: (message: string) => void | boolean | Promise<void | boolean>;
  onCancel?: () => void;
  sending?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  submitLabel?: string;
  sendingLabel?: string;
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  actionsClassName?: string;
};

export function AgentTellForm({
  onSend,
  onCancel,
  sending = false,
  ariaLabel = 'Tell active agent',
  placeholder = 'Tell this agent...',
  submitLabel = 'Send',
  sendingLabel = 'Sending…',
  multiline = false,
  className = 'flex gap-[8px]',
  inputClassName = 'h-[32px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-[10px] text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary',
  actionsClassName = '',
}: AgentTellFormProps) {
  const [message, setMessage] = useState('');

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    void Promise.resolve(onSend(text)).then((sent) => {
      if (sent !== false) setMessage('');
    });
  };

  const fieldProps = {
    value: message,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setMessage(event.target.value),
    placeholder,
    'aria-label': ariaLabel,
    className: inputClassName,
  };

  return (
    <form className={className} onSubmit={onSubmit}>
      {multiline ? <textarea {...fieldProps} /> : <input type="text" {...fieldProps} />}
      <div className={actionsClassName}>
        {onCancel ? (
          <button type="button" className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onCancel}>Cancel</button>
        ) : null}
        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="h-[32px] rounded-[var(--radius-sm)] bg-primary px-[12px] text-[12px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? sendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
