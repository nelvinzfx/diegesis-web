/**
 * Character Card V2 format importer — pure functions over strings/bytes.
 *
 * Ported from data/importer/CharacterCardImporter.kt. Supports both JSON
 * files and PNG files with embedded character data (tEXt chunk, keyword
 * "chara", base64-encoded JSON).
 */

import type { Npc } from '../shared/types.js';
import { defaultNpcAgency } from '../shared/types.js';

interface RawCard {
  spec?: string;
  spec_version?: string;
  data?: Partial<CardData> | null;
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
}

interface CardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
}

/** Import from JSON string. */
export function fromJson(jsonString: string, npcId: string): Npc {
  const card = JSON.parse(jsonString) as RawCard;
  return toNpc(card, npcId, null);
}

/** Import from PNG bytes with embedded character card data. */
export function fromPngBytes(pngBytes: Uint8Array, npcId: string): Npc {
  const jsonString = extractCharaFromPng(pngBytes);
  const card = JSON.parse(jsonString) as RawCard;
  // Node Buffer is acceptable here per phase-1 scope; base64 of the raw PNG.
  const sourceCard = Buffer.from(pngBytes).toString('base64');
  return toNpc(card, npcId, sourceCard);
}

function toNpc(card: RawCard, npcId: string, sourceCard: string | null): Npc {
  // V2 cards can have data either at root or in a 'data' block.
  const data = card.data ?? null;
  const name = data?.name ?? card.name ?? 'Unnamed';
  const description = data?.description ?? card.description ?? '';
  const personality = data?.personality ?? card.personality ?? '';
  const mesExample = data?.mes_example ?? card.mes_example ?? '';

  // Parse mes_example into voice examples (split by common delimiters).
  let voiceExamples: string[] = [];
  if (mesExample.trim().length > 0) {
    voiceExamples = mesExample
      .split(/<START>|\{\{char\}\}:|\{\{user\}\}:/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length > 10)
      .slice(0, 5);
  }

  return {
    id: npcId,
    name,
    description,
    personality,
    voiceExamples,
    agency: defaultNpcAgency(),
    trackers: {},
    sourceCard,
  };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Extract character card JSON from a PNG tEXt chunk.
 * PNG format: signature, then chunks of [length][type][data][crc].
 * We look for a tEXt chunk with keyword "chara". Exported for direct testing
 * on synthetic bytes.
 */
export function extractCharaFromPng(pngBytes: Uint8Array): string {
  let offset = 0;

  // Verify PNG signature.
  if (pngBytes.length < 8 || !PNG_SIGNATURE.every((b, i) => pngBytes[i] === b)) {
    throw new Error('Not a valid PNG file');
  }
  offset += 8;

  while (offset + 8 <= pngBytes.length) {
    // Chunk length (4 bytes, big-endian).
    const view = new DataView(pngBytes.buffer, pngBytes.byteOffset + offset, 4);
    const length = view.getUint32(0, false);
    offset += 4;

    // Chunk type (4 bytes, ISO-8859-1 / ASCII).
    const type = latin1(pngBytes.subarray(offset, offset + 4));
    offset += 4;

    const dataEnd = offset + length;
    if (dataEnd > pngBytes.length) break;
    const data = pngBytes.subarray(offset, dataEnd);
    offset = dataEnd;

    // Skip CRC (4 bytes).
    offset += 4;

    if (type === 'tEXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const keyword = latin1(data.subarray(0, nullIndex));
        if (keyword === 'chara') {
          const textData = data.subarray(nullIndex + 1);
          const base64String = latin1(textData);
          return Buffer.from(base64String, 'base64').toString('utf-8');
        }
      }
    }

    // Stop at IEND chunk.
    if (type === 'IEND') break;
  }

  throw new Error("No 'chara' tEXt chunk found in PNG");
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}
