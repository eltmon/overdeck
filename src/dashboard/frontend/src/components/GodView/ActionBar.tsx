import { useState } from 'react';
import { Pause, MessageSquare, GitBranch, Terminal, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { Agent } from '../../types';

interface ActionBarProps {
  agent: Agent;
  onClose: () => void;
}

export function ActionBar({ agent, onClose }: ActionBarProps) {
  const [messageText, setMessageText] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText }),
      });
      if (res.ok) {
        toast.success('Message sent to agent');
        setMessageText('');
        setShowMessageInput(false);
      } else {
        toast.error('Failed to send message');
      }
    } catch {
      toast.error('Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm(`Stop agent ${agent.id}?`)) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/stop`, { method: 'POST' });
      if (res.ok) {
        toast.success('Agent stopped');
        onClose();
      } else {
        toast.error('Failed to stop agent');
      }
    } catch {
      toast.error('Failed to stop agent');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Message button */}
        <button
          onClick={() => setShowMessageInput((v) => !v)}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
          style={{ background: 'rgba(0, 212, 255, 0.15)', color: 'var(--gv-blue)', border: '1px solid rgba(0, 212, 255, 0.3)' }}
        >
          <MessageSquare className="w-3 h-3" />
          Message
        </button>

        {/* Diff button */}
        <a
          href={`/api/agents/${agent.id}/files`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
          style={{ background: 'rgba(255, 184, 0, 0.15)', color: 'var(--gv-amber)', border: '1px solid rgba(255, 184, 0, 0.3)' }}
        >
          <GitBranch className="w-3 h-3" />
          Files
        </a>

        <div className="flex-1" />

        {/* Stop button */}
        {agent.status !== 'stopped' && (
          <button
            onClick={handleStop}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
            style={{ background: 'rgba(255, 45, 124, 0.15)', color: 'var(--gv-pink)', border: '1px solid rgba(255, 45, 124, 0.3)' }}
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}
      </div>

      {showMessageInput && (
        <div className="flex gap-2">
          <input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type a message to the agent..."
            className="flex-1 px-2.5 py-1.5 rounded-lg text-xs gv-mono outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--gv-border)',
              color: 'var(--gv-text-primary)',
            }}
            autoFocus
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim() || isLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--gv-blue)', color: '#000' }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
