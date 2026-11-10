import sharp from 'sharp'

import { bar } from '../../lib/bar.js'
import { APP_NAME, ART_FILE } from './config.js'

// Back display is 160x80, monochrome OLED with 16 gray levels. Letterbox the
// square album art (centered, black bars) rather than cropping it.
export async function uploadArtwork(artworkUrl: string): Promise<boolean> {
  try {
    const res = await fetch(artworkUrl)
    if (!res.ok) return false
    const source = Buffer.from(await res.arrayBuffer())
    const png = await sharp(source)
      .resize(160, 80, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .grayscale()
      .png()
      .toBuffer()
    await bar.AssetsUpload({
      application_name: APP_NAME,
      file: ART_FILE,
      data: new Blob([new Uint8Array(png)])
    })
    return true
  } catch {
    return false // artwork is decoration; the text scene works without it
  }
}
