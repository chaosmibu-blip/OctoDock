-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to memory table
ALTER TABLE memory ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create IVFFlat index for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_memory_embedding
  ON memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
