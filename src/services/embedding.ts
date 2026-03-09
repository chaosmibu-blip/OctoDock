// OpenAI text-embedding-3-small — $0.02/1M tokens
// Generates 1536-dimensional vectors for semantic search

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_EMBEDDING_API_KEY;
  if (!apiKey) return null; // Graceful fallback: no key = no embedding

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!res.ok) {
      console.error("Embedding API error:", await res.text());
      return null;
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("Embedding request failed:", err);
    return null;
  }
}

// Convert number array to pgvector format string: [0.1,0.2,...]
export function toVectorString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
