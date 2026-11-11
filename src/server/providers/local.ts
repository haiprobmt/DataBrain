import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tokenize } from "@/lib/utils";
import { sha256 } from "../crypto";
import type { DocumentExtractor, EmbeddingProvider, ObjectStorage, Reranker } from "./types";

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with".split(" "));

/**
 * Deterministic feature-hashing embedding (unigrams + bigrams, signed, L2-normalised).
 * It captures lexical overlap, not meaning: a stand-in so hybrid retrieval works offline.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-hash";
  readonly model = "feature-hash-256";
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text).filter((t) => !STOP.has(t));
    const features = [...tokens, ...tokens.slice(0, -1).map((t, i) => `${t}_${tokens[i + 1]}`)];
    for (const feature of features) {
      const h = fnv1a(feature);
      const idx = h % this.dimensions;
      vec[idx] = (vec[idx] ?? 0) + ((h >>> 16) & 1 ? 1 : -1);
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export class PassthroughReranker implements Reranker {
  readonly name = "none";
  async rerank<T extends { score: number }>(_query: string, items: T[]): Promise<T[]> {
    return [...items].sort((a, b) => b.score - a.score);
  }
}

export class PlainTextExtractor implements DocumentExtractor {
  readonly name = "plain-text";
  supports(fileName: string): boolean {
    return /\.(md|markdown|txt)$/i.test(fileName);
  }
  async extract(fileName: string, bytes: Uint8Array): Promise<{ text: string; title: string }> {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
    const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return { text, title: heading ?? fileName.replace(/\.[^.]+$/, "") };
  }
}

export class LocalFsStorage implements ObjectStorage {
  readonly name = "local-fs";
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const safe = key.split("/").map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_")).filter((p) => p && p !== "." && p !== "..");
    return path.join(this.root, ...safe);
  }

  async put(key: string, bytes: Uint8Array) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { key, checksum: sha256(bytes), size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch {
      return null;
    }
  }
}
