// Feeds the ffmpeg fragmented-MP4 stream into a <video> through Media Source Extensions.
// The stream is placed at its real position in the film (timestampOffset), so the video element's
// own clock is the film's clock and seeking inside buffered data, or to a time that's still arriving, just works.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class MseFeeder {
  private ms = new MediaSource()
  private sb?: SourceBuffer
  private ctrl?: AbortController
  private gen = 0
  private opened: Promise<void>
  readonly url: string

  constructor(
    private video: HTMLVideoElement,
    private duration: number,
    private mime: string,
    private onError: (e: Error) => void,
  ) {
    this.opened = new Promise((r) => this.ms.addEventListener('sourceopen', () => r(), { once: true }))
    this.url = URL.createObjectURL(this.ms)
    video.src = this.url
  }

  private idle() {
    const sb = this.sb
    return sb?.updating ? new Promise<void>((r) => sb.addEventListener('updateend', () => r(), { once: true })) : Promise.resolve()
  }

  /** True when t is already buffered, so a seek there needs no new stream. */
  has(t: number) {
    const b = this.sb?.buffered
    if (!b) return false
    for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t <= b.end(i) - 0.5) return true
    return false
  }

  /** Start feeding a stream that begins at `offset` seconds into the film. */
  async start(src: string, offset: number) {
    const gen = ++this.gen
    this.ctrl?.abort()
    await this.opened
    if (gen !== this.gen) return
    if (!this.sb) {
      if (Number.isFinite(this.duration) && this.duration > 0) this.ms.duration = this.duration
      this.sb = this.ms.addSourceBuffer(this.mime)
      this.sb.mode = 'segments'
    } else {
      await this.idle()
      if (gen !== this.gen) return
      if (this.ms.readyState === 'open') this.sb.abort()
      if (this.sb.buffered.length) {
        this.sb.remove(0, Infinity)
        await this.idle()
      }
    }
    // something can slip an append in while we waited; the offset can only change when the buffer is idle
    while (this.sb.updating) await this.idle()
    if (gen !== this.gen) return
    this.sb.timestampOffset = offset
    const ctrl = (this.ctrl = new AbortController())
    try {
      const res = await fetch(src, { signal: ctrl.signal })
      if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (gen !== this.gen) return void reader.cancel().catch(() => undefined)
        if (done) break
        await this.append(value, gen)
      }
      if (gen === this.gen && this.ms.readyState === 'open') {
        await this.idle()
        this.ms.endOfStream()
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && gen === this.gen) this.onError(e as Error)
    }
  }

  private async append(chunk: Uint8Array, gen: number) {
    for (;;) {
      await this.idle()
      if (gen !== this.gen || !this.sb) return
      const b = this.sb.buffered
      // stay at most 90 seconds ahead of playback
      if (b.length && b.end(b.length - 1) - this.video.currentTime > 90) {
        await sleep(400)
        continue
      }
      try {
        this.sb.appendBuffer(chunk as BufferSource)
        return
      } catch (e) {
        if ((e as DOMException).name !== 'QuotaExceededError') throw e
        // full: drop what's well behind playback, or wait for playback to use some up
        const cut = this.video.currentTime - 15
        if (b.length && b.start(0) < cut) {
          this.sb.remove(b.start(0), cut)
          await this.idle()
        } else await sleep(500)
      }
    }
  }

  destroy() {
    this.gen++
    this.ctrl?.abort()
    URL.revokeObjectURL(this.url)
  }
}
