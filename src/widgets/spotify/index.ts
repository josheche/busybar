import { bar, toAscii } from '../../lib/bar.js'
import { AMBIENT } from '../../lib/priorities.js'
import { uploadArtwork } from './artwork.js'
import { APP_NAME, ELEMENT_TIMEOUT_S, POLL_MS } from './config.js'
import { getNowPlaying } from './nowplaying.js'

let lastTrackId: string | null = null
let hasArtwork = false

async function drawScene(artist: string, title: string) {
  const line = toAscii(artist ? `${artist} - ${title}` : title)
  await bar.DisplayDraw({
    application_name: APP_NAME,
    priority: AMBIENT,
    elements: [
      {
        id: 'track',
        type: 'text',
        display: 'front',
        align: 'center',
        x: 36,
        y: 8,
        width: 72,
        font: 'small',
        color: '#FFFFFFFF',
        text: line,
        scroll_rate: 1200,
        scroll_start_delay: 1500,
        scroll_repeat_delay: 2500,
        timeout: ELEMENT_TIMEOUT_S
      },
      ...(hasArtwork
        ? [
            {
              id: 'art',
              type: 'image' as const,
              display: 'back' as const,
              x: 0,
              y: 0,
              path: 'art.png',
              opacity: 100,
              timeout: ELEMENT_TIMEOUT_S
            }
          ]
        : [])
    ]
  })
}

async function tick() {
  const playing = await getNowPlaying()

  if (!playing) {
    // Paused/closed: stop re-sending and let elements time out on their own,
    // but clear eagerly so the screen frees up right away.
    if (lastTrackId !== null) {
      lastTrackId = null
      hasArtwork = false
      await bar.DisplayClear({ application_name: APP_NAME }).catch(() => {})
    }
    return
  }

  if (playing.trackId !== lastTrackId) {
    lastTrackId = playing.trackId
    hasArtwork = playing.artworkUrl ? await uploadArtwork(playing.artworkUrl) : false
  }

  // Re-send every tick: liveness by repetition. If this daemon dies, the
  // elements expire and the display returns to whatever the bar was doing.
  await drawScene(playing.artist, playing.title)
}

console.info(`busybar spotify widget: polling every ${POLL_MS}ms`)
setInterval(() => {
  tick().catch((err) => console.error('tick failed:', err.message ?? err))
}, POLL_MS)
tick().catch((err) => console.error('tick failed:', err.message ?? err))
