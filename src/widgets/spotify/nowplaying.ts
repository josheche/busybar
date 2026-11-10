import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type NowPlaying = {
  trackId: string
  artist: string
  title: string
  artworkUrl: string
}

const SCRIPT = `
if application "Spotify" is running then
  tell application "Spotify"
    if player state is playing then
      return id of current track & "\\n" & artist of current track & "\\n" & name of current track & "\\n" & artwork url of current track
    end if
  end tell
end if
return ""
`

// Returns null when Spotify is closed, paused, or between tracks.
export async function getNowPlaying(): Promise<NowPlaying | null> {
  const { stdout } = await exec('osascript', ['-e', SCRIPT])
  const out = stdout.trim()
  if (!out) return null
  const [trackId, artist, title, artworkUrl] = out.split('\n')
  if (!trackId || !title) return null
  return { trackId, artist: artist ?? '', title, artworkUrl: artworkUrl ?? '' }
}
