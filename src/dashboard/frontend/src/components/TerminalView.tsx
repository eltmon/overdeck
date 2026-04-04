import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { Terminal, Send, RefreshCw } from 'lucide-react';

interface TerminalViewProps {
  agentId: string;
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

async function sendMessage(agentId: string, message: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error('Failed to send message');
}

export function TerminalView({ agentId }: TerminalViewProps) {
  const [message, setMessage] = useState('');
  const outputRef = useRef<HTMLPreElement>(null);

  const { data: output, isLoading, refetch } = useQuery({
    queryKey: ['agent-output', agentId],
    queryFn: () => fetchOutput(agentId),
    refetchInterval: 2000,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) => sendMessage(agentId, msg),
    onSuccess: () => {
      setMessage('');
      setTimeout(() => refetch(), 500);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMutation.mutate(message.trim());
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg flex flex-col h-[600px]">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Terminal className="w-5 h-5" />
          {agentId}
        </h2>
        <button
          onClick={() => refetch()}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <pre
        ref={outputRef}
        className="flex-1 overflow-auto p-4 terminal-output text-gray-300 bg-gray-900"
      >
        {isLoading ? (
          <span className="text-gray-500">Loading...</span>
        ) : output ? (
          output
        ) : (
          <span className="text-gray-500">No output yet</span>
        )}
      </pre>

      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Send message to agent..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!message.trim() || sendMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
