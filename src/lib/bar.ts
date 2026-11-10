import { BusyBar } from '@busy-app/busy-lib'

// USB virtual LAN address (no auth needed). Override for Wi-Fi/cloud:
//   BUSYBAR_ADDR=192.168.x.x BUSYBAR_PASSWORD=... (LAN)
//   BUSYBAR_ADDR=https://api.busy.app BUSYBAR_TOKEN=... (internet)
export const bar = new BusyBar({
  addr: process.env.BUSYBAR_ADDR ?? '10.0.4.20',
  ...(process.env.BUSYBAR_TOKEN ? { token: process.env.BUSYBAR_TOKEN } : {}),
  ...(process.env.BUSYBAR_PASSWORD ? { HTTPAccessPassword: process.env.BUSYBAR_PASSWORD } : {})
})

// The `.anim` container version the firmware plays, read from the signature of a stock
// animation that ships with every firmware. Compare with ANIM_SIGNATURE in ./anim.ts before
// uploading: a file with any other signature uploads fine and then renders as a magenta box.
const STOCK_ANIM = '/ext/apps_assets/shared/animations/spinner_front_8x8.anim'
export async function readDeviceAnimSignature(): Promise<string> {
  const res = await bar.StorageRead({ path: STOCK_ANIM }, { as_array_buffer: true })
  const bytes = new Uint8Array(res instanceof Blob ? await res.arrayBuffer() : res)
  return new TextDecoder().decode(bytes.subarray(0, 8))
}

// Fonts are bitmap ASCII — the API rejects text with non-printable-ASCII chars.
export function toAscii(s: string): string {
  const cleaned = s
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
  return cleaned.length > 0 ? cleaned : '?'
}
