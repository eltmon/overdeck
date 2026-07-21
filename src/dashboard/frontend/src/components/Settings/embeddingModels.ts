/** Known embedding models per provider for the embeddings picker (PAN-1589). */
interface EmbeddingModelOption {
  id: string;
  label: string;
  description: string;
}

export const EMBEDDING_MODELS_BY_PROVIDER: Record<string, EmbeddingModelOption[]> = {
  openai: [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small', description: 'Recommended · 1536-dim · $0.02 / 1M tokens — cheap & fast' },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large', description: 'Higher quality · 3072-dim · $0.13 / 1M tokens' },
    { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002', description: 'Legacy · 1536-dim — prefer 3-small' },
  ],
  voyage: [
    { id: 'voyage-code-3', label: 'voyage-code-3', description: 'Code-optimized · $0.18 / 1M tokens' },
    { id: 'voyage-3', label: 'voyage-3', description: 'General-purpose semantic embeddings' },
  ],
  ollama: [
    { id: 'nomic-embed-text', label: 'nomic-embed-text', description: 'Local via Ollama · free · nothing leaves your machine' },
    { id: 'mxbai-embed-large', label: 'mxbai-embed-large', description: 'Local via Ollama · free · larger, higher quality' },
  ],
};
