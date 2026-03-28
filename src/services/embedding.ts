// OpenAI text-embedding-3-small — $0.02/1M tokens
// Generates 1536-dimensional vectors for semantic search

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * 呼叫 OpenAI Embedding API 產生 1536 維向量
 * 用於記憶的語意搜尋（pgvector cosine similarity）
 * @returns 向量陣列，或 null（API key 未設定或呼叫失敗時靜默降級）
 */
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

/** 將數字陣列轉為 pgvector 格式字串：[0.1,0.2,...] */
export function toVectorString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
