import { describe, expect, it } from 'vitest';
import { extractCharaFromPng, fromJson, fromPngBytes } from './card-importer.js';

// ---- PNG builder (mirrors the Android test's createTestPng helper) ----------

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let table = CRC_TABLE.value;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    CRC_TABLE.value = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
const CRC_TABLE: { value: Uint32Array | null } = { value: null };

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = encoder.encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

function pngSignature(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

function ihdrChunk(): Uint8Array {
  // Minimal 1x1 truecolor image header.
  return chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
}

function idatChunk(): Uint8Array {
  return chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A valid PNG with an embedded chara card. */
function buildTestPng(jsonData: string): Uint8Array {
  const base64Json = Buffer.from(jsonData, 'utf-8').toString('base64');
  const keyword = Buffer.from('chara', 'latin1');
  const payload = Buffer.concat([keyword, Buffer.from([0]), Buffer.from(base64Json, 'latin1')]);
  return concat(
    pngSignature(),
    ihdrChunk(),
    chunk('tEXt', new Uint8Array(payload)),
    idatChunk(),
    chunk('IEND', new Uint8Array(0)),
  );
}

/** A valid PNG without a chara chunk. */
function buildTestPngWithoutChara(): Uint8Array {
  return concat(pngSignature(), ihdrChunk(), idatChunk(), chunk('IEND', new Uint8Array(0)));
}

// ---- tests -------------------------------------------------------------------

describe('CharacterCardImporter', () => {
  it('imports a spec_v2 JSON card', () => {
    const jsonCard = `{
      "spec": "chara_card_v2",
      "spec_version": "2.0",
      "data": {
        "name": "Test Character",
        "description": "A brave warrior from the north",
        "personality": "Courageous and honorable",
        "scenario": "Fighting in the great war",
        "first_mes": "Hello, traveler!",
        "mes_example": "<START>\\n{{char}}: I swear by my honor!\\n{{user}}: That's noble of you.\\n{{char}}: A warrior's word is their bond."
      }
    }`;

    const npc = fromJson(jsonCard, 'npc-test');

    expect(npc.id).toBe('npc-test');
    expect(npc.name).toBe('Test Character');
    expect(npc.description).toBe('A brave warrior from the north');
    expect(npc.personality).toBe('Courageous and honorable');
    expect(npc.firstMessage).toBe('Hello, traveler!');
    expect(npc.voiceExamples.length).toBeGreaterThanOrEqual(2);
    expect(npc.sourceCard).toBeNull();
  });

  it('imports a legacy root-level V2 card', () => {
    const jsonCard = `{
      "name": "Root Character",
      "description": "Character at root",
      "personality": "Mysterious",
      "scenario": "Exploring ruins",
      "mes_example": "{{char}}: Let's venture forth!\\n{{user}}: Right behind you.\\n{{char}}: Stay close."
    }`;

    const npc = fromJson(jsonCard, 'npc-root');

    expect(npc.id).toBe('npc-root');
    expect(npc.name).toBe('Root Character');
    expect(npc.description).toBe('Character at root');
    expect(npc.personality).toBe('Mysterious');
    expect(npc.voiceExamples.length).toBeGreaterThan(0);
  });

  it('maps root-level first_mes when no data block exists', () => {
    const jsonCard = JSON.stringify({
      name: 'Root First',
      description: 'x',
      first_mes: 'Welcome to the docks, stranger.',
    });
    const npc = fromJson(jsonCard, 'npc-root-first');
    expect(npc.firstMessage).toBe('Welcome to the docks, stranger.');
  });

  it('data-block first_mes wins over a stale root copy', () => {
    const jsonCard = JSON.stringify({
      first_mes: 'root copy',
      data: { name: 'Dup', first_mes: 'data copy' },
    });
    expect(fromJson(jsonCard, 'npc-dup').firstMessage).toBe('data copy');
  });

  it('missing first_mes maps to empty string', () => {
    const npc = fromJson('{"data":{"name":"No First"}}', 'npc-nofirst');
    expect(npc.firstMessage).toBe('');
  });

  it('imports a PNG card and stores base64 sourceCard', () => {
    const jsonCard = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'PNG Character',
        description: 'Character from PNG',
        personality: 'Friendly and helpful',
        scenario: 'In a tavern',
        mes_example: '{{char}}: Welcome, friend!',
      },
    });

    const pngBytes = buildTestPng(jsonCard);
    const npc = fromPngBytes(pngBytes, 'npc-png');

    expect(npc.id).toBe('npc-png');
    expect(npc.name).toBe('PNG Character');
    expect(npc.description).toBe('Character from PNG');
    expect(npc.personality).toBe('Friendly and helpful');
    expect(npc.sourceCard).not.toBeNull();
    const decoded = Buffer.from(npc.sourceCard!, 'base64');
    expect(decoded.length).toBeGreaterThan(0);
    // Round-trip: decoded bytes are exactly the original PNG.
    expect(Buffer.compare(Buffer.from(pngBytes), decoded)).toBe(0);
  });

  it('parses multiple voice examples', () => {
    const jsonCard = `{
      "data": {
        "name": "Talkative NPC",
        "description": "Loves to chat",
        "personality": "Chatty",
        "mes_example": "<START>\\n{{char}}: Hello there, friend! How are you today?\\n{{user}}: I'm doing well.\\n<START>\\n{{char}}: That's wonderful to hear! Would you like to hear a story?\\n{{user}}: Sure!\\n{{char}}: Once upon a time, in a land far away..."
      }
    }`;

    const npc = fromJson(jsonCard, 'npc-talk');

    expect(npc.voiceExamples.length).toBeGreaterThan(0);
    expect(
      npc.voiceExamples.some((v) => v.includes('Hello there') || v.includes('wonderful to hear')),
    ).toBe(true);
  });

  it('caps voice examples at five', () => {
    const lines = Array.from({ length: 9 }, (_, i) => `<START>\n{{char}}: Example line number ${i} for voice.`).join('\n');
    const jsonCard = JSON.stringify({
      data: { name: 'Cap NPC', description: '', personality: '', mes_example: lines },
    });
    const npc = fromJson(jsonCard, 'npc-cap');
    expect(npc.voiceExamples).toHaveLength(5);
  });

  it('imports a minimal card with defaults', () => {
    const jsonCard = '{"data": {"name": "Minimal NPC"}}';
    const npc = fromJson(jsonCard, 'npc-min');
    expect(npc.id).toBe('npc-min');
    expect(npc.name).toBe('Minimal NPC');
    expect(npc.description).toBe('');
    expect(npc.personality).toBe('');
    expect(npc.firstMessage).toBe('');
    expect(npc.voiceExamples).toEqual([]);
  });

  it('falls back to Unnamed when no name exists', () => {
    const npc = fromJson('{"data":{}}', 'npc-unnamed');
    expect(npc.name).toBe('Unnamed');
  });

  it('rejects invalid PNG bytes', () => {
    const invalidBytes = new TextEncoder().encode('Not a PNG file');
    expect(() => fromPngBytes(invalidBytes, 'npc-invalid')).toThrow('Not a valid PNG file');
  });

  it('rejects a PNG without a chara chunk', () => {
    const pngBytes = buildTestPngWithoutChara();
    expect(() => fromPngBytes(pngBytes, 'npc-no-chara')).toThrow("No 'chara' tEXt chunk found in PNG");
  });

  it('extractCharaFromPng decodes the embedded base64 JSON', () => {
    const jsonCard = '{"data":{"name":"Direct"}}';
    const extracted = extractCharaFromPng(buildTestPng(jsonCard));
    expect(extracted).toBe(jsonCard);
  });
});
