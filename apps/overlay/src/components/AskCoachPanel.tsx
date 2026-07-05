import { useState } from 'react';

export interface AskCoachPanelProps {
  getContext: () => unknown;
  endpoint?: string;
}

const NO_KEY_MESSAGE = 'Set OPENAI_API_KEY on the listener to enable AI coaching (GPT-4o).';
const UNAVAILABLE_MESSAGE = 'Coach unavailable — is the listener running?';

export function AskCoachPanel({ getContext, endpoint = 'http://127.0.0.1:53000/coach' }: AskCoachPanelProps) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  const ask = async () => {
    if (loading || question.trim() === '') return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, context: getContext() }),
      });
      if (res.status === 200) {
        const data = (await res.json()) as { answer?: unknown };
        setAnswer(typeof data.answer === 'string' ? data.answer : UNAVAILABLE_MESSAGE);
      } else if (res.status === 501) {
        setAnswer(NO_KEY_MESSAGE);
      } else {
        setAnswer(UNAVAILABLE_MESSAGE);
      }
    } catch {
      setAnswer(UNAVAILABLE_MESSAGE);
    }
    setLoading(false);
  };

  return (
    <div style={{ fontSize: 12 }}>
      <form style={{ display: 'flex', gap: 4 }} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask the coach…"
          style={{
            flex: 1, fontSize: 12, padding: '2px 6px',
            background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4,
          }}
        />
        <button type="submit" disabled={loading || question.trim() === ''} style={{ fontSize: 12 }}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>
      {answer !== null && <div style={{ marginTop: 6, color: '#e5e7eb' }}>{answer}</div>}
    </div>
  );
}
