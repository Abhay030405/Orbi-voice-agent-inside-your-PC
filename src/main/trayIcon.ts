// Draws the tray icon in code: a small anti-aliased dot in the agent-state colour, encoded as a PNG.
// No image files to ship, and the icon can change colour with the state.
//
// A PNG is: an 8-byte signature, then "chunks" (IHDR = size/format, IDAT = the pixels compressed with
// zlib/deflate, IEND = end). Each chunk is length + type + data + a CRC32 checksum. Node has deflate
// and crc32 built in (zlib), so the encoder is a few lines.

import { crc32, deflateSync } from 'node:zlib'
import type { AgentState } from '../shared/ipc'

const STATE_RGB: Record<AgentState, [number, number, number]> = {
  idle: [139, 92, 246], // our accent violet: "on, waiting"
  listening: [59, 130, 246],
  thinking: [245, 158, 11],
  speaking: [34, 197, 94]
}

export function trayIconPng(state: AgentState, size = 32): Buffer {
  const [r, g, b] = STATE_RGB[state]
  const rgba = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size * 0.38

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center)
      // Anti-aliasing: pixels on the edge get partial opacity instead of a jagged on/off.
      const coverage = Math.max(0, Math.min(1, radius - distance + 0.5))
      const i = (y * size + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = Math.round(coverage * 255)
    }
  }
  return encodePng(rgba, size, size)
}

function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  // Each row starts with a "filter type" byte; 0 = none.
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // 8 bits per channel
  header[9] = 6 // colour type 6 = RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}
