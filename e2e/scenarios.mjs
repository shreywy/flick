// Each scenario gets { app, page, shot, log, sleep }.

const waitQueueIdle = async ({ page, sleep, log }, timeout = 120000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const q = await page.evaluate(() => window.flick.invoke('queue:get'))
    const busy = q.counts.working + q.counts.waiting
    if (!busy) return q
    await sleep(1500)
  }
  throw new Error('queue never finished')
}

export async function setup(ctx) {
  const { page, shot, log } = ctx
  await page.getByRole('button', { name: 'Start' }).waitFor({ timeout: 20000 })
  await shot('first-run')
  await page.getByLabel('Media folder').fill(process.env.E2E_MEDIA)
  await page.getByLabel('TMDB key').fill(process.env.E2E_TMDB)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.locator('.header').waitFor({ timeout: 30000 })
  const q = await waitQueueIdle(ctx)
  log('queue', JSON.stringify(q.counts), JSON.stringify(q.items.map((i) => [i.name, i.status, i.message, i.target])))
  await page.evaluate(() => (location.hash = '#/settings/queue'))
  await ctx.sleep(800)
  await shot('queue')
  await page.evaluate(() => (location.hash = '#/'))
  await ctx.sleep(1500)
  await shot('home')
}

export async function browse(ctx) {
  const { page, shot, sleep } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  await waitQueueIdle(ctx, 600000)
  await sleep(1500)
  await shot('home')
  await page.mouse.wheel(0, 900)
  await sleep(600)
  await shot('home-scrolled')
  await page.evaluate(() => scrollTo(0, 0))
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await sleep(1000)
  await shot('movies')
  await page.getByRole('button', { name: /^Marvel/ }).click()
  await sleep(400)
  await shot('movies-marvel')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByLabel('Search your library').pressSequentially('star', { delay: 80 })
  await sleep(500)
  await shot('search-star')
  await page.getByLabel('Search your library').fill('mcconaughey')
  await sleep(400)
  await shot('search-actor')
  await page.locator('.poster').first().click()
  await sleep(1500)
  await shot('movie-page')
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Shows', exact: true }).click()
  await page.locator('.poster').first().click()
  await sleep(1500)
  await shot('show-page')
  await page.evaluate(() => (location.hash = '#/settings/queue'))
  await sleep(800)
  await shot('settings-queue')
}

/** Play a file, check it advances, seek precisely, toggle subs. E2E_FILE = title name to play. */
export async function play(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const want = process.env.E2E_FILE
  const t = lib.titles.find((x) => x.name.toLowerCase().includes(want.toLowerCase()))
  if (!t) throw new Error(`no title like ${want}`)
  const fileId = t.fileId ?? t.episodes[0].fileId
  const info = await page.evaluate((id) => window.flick.invoke('play:info', id), fileId)
  log('mode', info.mode, 'audio', JSON.stringify(info.audio.map((a) => a.codec)), 'subs', JSON.stringify(info.subs.map((s) => [s.label, s.format])), 'pref', JSON.stringify(info.subPrefs))
  await page.evaluate((id) => (location.hash = `#/play/${id}/start`), fileId)
  const v = page.locator('video')
  const state = () => v.evaluate((el) => ({ t: el.currentTime, paused: el.paused, ready: el.readyState, err: el.error?.message ?? null, w: el.videoWidth, src: el.src.split('?')[0] }))
  let s
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    s = await state()
    if (s.t > 2 || s.err) break
  }
  log('after start', JSON.stringify(s))
  if (!(s.t > 1)) throw new Error('video did not start: ' + JSON.stringify(s))
  // audio is really decoding?
  const audio = await v.evaluate((el) => el.webkitAudioDecodedByteCount ?? -1)
  log('audio bytes decoded', audio)
  await page.mouse.move(600, 600)
  await shot('playing')
  // precise seek far ahead (forces a stream restart in remux/convert mode)
  const target = Math.min(info.duration - 120, 1234.5)
  const seekbar = page.getByRole('slider', { name: 'Seek' })
  const box = await seekbar.boundingBox()
  const t0 = Date.now()
  await page.evaluate((x) => window.__flickSeek(x), target)
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const now = Number(await seekbar.getAttribute('aria-valuenow'))
    s = await state()
    if (!s.paused && Math.abs(now - target) < 30 && s.ready >= 3) break
  }
  const shown = Number(await seekbar.getAttribute('aria-valuenow'))
  log('after seek', 'target', target.toFixed(1), 'shown', shown, 'took', Date.now() - t0, 'ms', JSON.stringify(s))
  if (Math.abs(shown - target) > 4) throw new Error(`seek landed at ${shown}, wanted ${target}`)
  let subsOnScreen
  const wantSubs = !!info.subPrefs.track
  for (let i = 0; i < (wantSubs ? 60 : 3); i++) {
    await sleep(1000)
    subsOnScreen = await page.evaluate(() => ({ cues: document.querySelectorAll('.cue').length, text: [...document.querySelectorAll('.cue')].map((c) => c.textContent).join(' | ').slice(0, 80), canvas: !!document.querySelector('.player canvas') }))
    if (subsOnScreen.cues || subsOnScreen.canvas) break
  }
  log('subs on screen', JSON.stringify(subsOnScreen))
  const a2 = await v.evaluate((el) => el.webkitAudioDecodedByteCount)
  log('audio bytes decoded after seek', a2)
  await shot('after-seek')
  // hover preview
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await sleep(700)
  await shot('seek-hover')
  // captions menu
  await page.getByRole('button', { name: 'Player settings' }).click()
  await sleep(400)
  await shot('captions-menu')
  await page.getByText('Style and timing').click()
  await sleep(300)
  if (await page.getByRole('button', { name: 'More size' }).isEnabled()) {
    await page.getByRole('button', { name: 'More size' }).click()
    await page.getByRole('button', { name: 'More size' }).click()
    await page.getByRole('button', { name: 'Yellow' }).click()
  } else log('style locked for this track (styled subtitles)')
  await sleep(300)
  await shot('style-menu')
  await page.locator('.menu button[aria-label="Back"]').click()
  await page.getByText('Audio', { exact: true }).click()
  await sleep(300)
  await shot('audio-tab')
  await page.getByText('Picture', { exact: true }).click()
  await page.getByText('Fit', { exact: true }).click()
  await sleep(300)
  const fit = await v.evaluate((el) => el.style.transform)
  await page.getByText('Fill screen', { exact: true }).click()
  await sleep(1500)
  const fill = await v.evaluate((el) => el.style.transform)
  log('zoom fit', fit, 'fill', fill)
  await shot('picture-fill')
  await page.keyboard.press('Escape')
  await sleep(300)
  // keyboard skip
  const before = Number(await seekbar.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  await sleep(2500)
  const after = Number(await seekbar.getAttribute('aria-valuenow'))
  log('arrow right', before, '->', after)
  await page.keyboard.press('Space')
  await sleep(400)
  s = await state()
  log('after space paused=', s.paused)
  await shot('paused')
  await page.keyboard.press('Escape')
  await sleep(1000)
  const prog = await page.evaluate(() => window.flick.invoke('library:get'))
  log('progress saved', JSON.stringify(prog.progress[fileId]))
}

export async function fix(ctx) {
  const { page, log, sleep } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const q = await page.evaluate(() => window.flick.invoke('queue:get'))
  const row = q.items.find((i) => i.action === 'fix')
  if (!row) throw new Error('no row needs fixing')
  await page.evaluate(() => (location.hash = '#/settings/queue'))
  await page.getByRole('button', { name: 'Fix match' }).click()
  const box = page.getByLabel('Title to search for')
  await box.fill('Sintel')
  await page.locator('.pick').first().waitFor({ timeout: 15000 })
  await ctx.shot('fix-dialog')
  await page.locator('.pick').first().click()
  const done = await waitQueueIdle(ctx)
  log('after fix', JSON.stringify(done.items.map((i) => [i.name, i.status, i.target, i.message])))
  await sleep(1000)
  await page.evaluate(() => (location.hash = '#/movies'))
  await sleep(1000)
  await ctx.shot('movies-after-fix')
}

/** Seek to E2E_AT seconds in E2E_FILE and screenshot, to eyeball subtitles. */
export async function frame(ctx) {
  const { page, shot, sleep } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const t = lib.titles.find((x) => x.name.toLowerCase().includes(process.env.E2E_FILE.toLowerCase()))
  await page.evaluate((id) => (location.hash = `#/play/${id}/start`), t.fileId ?? t.episodes[0].fileId)
  await page.locator('video').waitFor()
  await sleep(4000)
  await page.keyboard.press('Space')
  await page.evaluate((x) => window.__flickSeek(x), Number(process.env.E2E_AT))
  await sleep(5000)
  await shot('frame')
  ctx.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => {
    const r = c.getBoundingClientRect()
    const cs = getComputedStyle(c)
    return { parent: c.parentElement?.className, cls: c.className, r: [r.x, r.y, r.width, r.height].map(Math.round), w: c.width, h: c.height, pos: cs.position, z: cs.zIndex, disp: cs.display, vis: cs.visibility, op: cs.opacity, style: c.getAttribute('style') }
  }))))
}

export async function frames(ctx) {
  const { page, shot, sleep } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const t = lib.titles.find((x) => x.name.toLowerCase().includes(process.env.E2E_FILE.toLowerCase()))
  await page.evaluate((id) => (location.hash = `#/play/${id}/start`), t.fileId ?? t.episodes[0].fileId)
  await page.locator('video').waitFor()
  await sleep(4000)
  await page.evaluate((x) => window.__flickSeek(x), Number(process.env.E2E_AT))
  for (let i = 0; i < 4; i++) {
    await sleep(1200)
    const ct = await page.locator('video').evaluate((v) => v.currentTime.toFixed(2))
    await shot(`t${ct}`)
  }
}

// Continue watching opens paused, the card grows into the player, back shrinks it, skip intro / credits on a show.
export async function flow(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  log('window buttons', await page.locator('.wctl button').count())
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const show = lib.titles.find((x) => x.name.includes('Mandalorian'))
  const ep = show.episodes.find((e) => e.season === 2 && e.episode === 2)
  // give it some progress so it's in Continue watching
  await page.evaluate((id) => window.flick.invoke('progress:save', id, 600, 2000), ep.fileId)
  await page.evaluate(() => window.flick.invoke('library:rescan')).catch(() => {})
  await page.evaluate(() => (location.hash = '#/movies'))
  await sleep(600)
  await page.evaluate(() => (location.hash = '#/'))
  await sleep(1500)
  const card = page.locator('.thumb', { hasText: 'Mandalorian' })
  await card.waitFor({ timeout: 10000 })
  const fid = Number(await card.getAttribute('data-file'))
  const resumeAt = (await page.evaluate(() => window.flick.invoke('library:get'))).progress[fid]?.position ?? 0
  log('card file', fid, 'resume at', resumeAt)
  await card.click()
  await sleep(250)
  await shot('enter-mid')
  await sleep(2500)
  const v = page.locator('video')
  const st = await v.evaluate((el) => ({ t: el.currentTime, paused: el.paused }))
  log('resume state', JSON.stringify(st))
  if (resumeAt >= 5 ? !st.paused || Math.abs(st.t - (resumeAt - 3)) > 2 : st.paused) throw new Error('resume should open paused, a fresh start should play')
  await shot('resumed-paused')
  const marks = await page.evaluate((id) => window.flick.invoke('play:markers', id), fid)
  log('markers', JSON.stringify(marks))
  if (marks.intro) {
    await page.evaluate((t) => window.__flickSeek(t), marks.intro[0] + 1)
    await page.getByRole('button', { name: 'Skip intro' }).waitFor({ timeout: 8000 })
    await sleep(2500)
    await shot('skip-intro')
    await page.getByRole('button', { name: 'Skip intro' }).click()
    await sleep(1500)
    log('after skip intro', await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow'))
  }
  if (marks.credits) {
    await page.evaluate((t) => window.__flickSeek(t), marks.credits + 2)
    await page.locator('.upnext').waitFor({ timeout: 8000 })
    log('upnext', await page.locator('.upnext').innerText())
    await sleep(3000)
    await shot('credits-upnext')
    log('still there', await page.locator('.upnext').count(), 'video t', await v.evaluate((el) => el.currentTime))
  }
  await page.locator('.upnext button', { hasText: 'Cancel' }).click().catch(() => {})
  await page.keyboard.press('Escape')
  // freeze the flight part way through to look at it
  await page.waitForFunction(() => document.getAnimations().some((a) => a.effect?.pseudoElement === '::view-transition-group(flick-play)' && a.effect.getKeyframes().length === 3), null, { timeout: 8000 })
  for (const f of [0.25, 0.5, 0.75]) {
    const t = await page.evaluate((f) => {
      const all = document.getAnimations()
      for (const a of all) {
        a.pause()
        a.currentTime = f * 720
      }
      return all.length
    }, f)
    await shot(`leave-${f * 100}`)
    log('frozen', f, 'animations', t)
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
  await sleep(1500)
  await shot('back-home')
  await page.mouse.move(1700, 1100)
  await sleep(500)
  await shot('row-hover')
  await page.mouse.wheel(0, 500)
  await sleep(700)
  await shot('scrolled-header')
  log('hash', await page.evaluate(() => location.hash))
}

// Motion checks: Resume from the banner, the way back, opening a film's page, shift + wheel on a row, Play from a banner.
export async function motion(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  await sleep(1500)
  const freeze = async (label, ms, fracs) => {
    for (const f of fracs) {
      await page.evaluate((t) => document.getAnimations().forEach((a) => (a.pause(), (a.currentTime = t))), f * ms)
      await shot(`${label}-${Math.round(f * 100)}`)
    }
    await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
  }
  const waitNav = (kind) => page.waitForFunction((k) => document.documentElement.dataset.nav === k && document.getAnimations().length > 0, kind, { timeout: 8000 })

  await page.getByRole('button', { name: /^(Resume|Play)$/ }).first().click()
  await waitNav('play')
  log('resume nav', await page.evaluate(() => document.documentElement.dataset.nav))
  await freeze('resume', 820, [0.2, 0.45])
  await sleep(2500)
  await page.keyboard.press('Escape')
  await waitNav('leave')
  await freeze('back', 620, [0.3, 0.6, 0.85])
  await sleep(1500)
  await shot('home')

  // shift + wheel on the second row (dispatched directly: the test window's own wheel can't reach rows below its fold)
  const moved = await page.locator('.row-track').nth(1).evaluate(async (t) => {
    const a = t.scrollLeft
    for (let i = 0; i < 3; i++) t.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, shiftKey: true, cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return t.scrollLeft - a
  })
  log('shift wheel x3 moved', moved, 'px in 400ms')

  // a film's page
  await page.evaluate(() => scrollTo(0, 0))
  await page.locator('.poster', { hasText: 'Your Name' }).first().click()
  await waitNav('page')
  await freeze('to-title', 320, [0.15, 0.5])
  await sleep(1200)
  await shot('title-page')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitNav('zoom')
  await freeze('zoom', 540, [0.3, 0.7])
  await sleep(1500)
  await page.keyboard.press('Escape')
  await sleep(1500)
}

export async function zoomplay(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const t = lib.titles.find((x) => x.name.startsWith('Your Name'))
  await page.evaluate((id) => (location.hash = `#/title/${id}`), t.id)
  await sleep(1500)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.getAnimations().some((a) => String(a.effect?.pseudoElement ?? '').startsWith('::view-transition')), null, { timeout: 8000 })
  log('nav', await page.evaluate(() => document.documentElement.dataset.nav))
  log('named', await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).viewTransitionName !== 'none').map((e) => e.className + ':' + getComputedStyle(e).viewTransitionName)))
  for (const f of [0.3, 0.7]) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => String(a.effect?.pseudoElement ?? '').startsWith('::view-transition') && (a.pause(), (a.currentTime = ms))), f * 540)
    await shot(`zoom-${f * 100}`)
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
  await sleep(1500)
  await shot('player')
  await page.keyboard.press('Escape')
  await sleep(1500)
  await shot('back-title')
}

// Play buttons: a film's grows into the player; a show's flies from the episode's card (or grows, if the card is off screen).
export async function buttons(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const vtStarted = () => page.waitForFunction(() => document.getAnimations().some((a) => String(a.effect?.pseudoElement ?? '').startsWith('::view-transition')), null, { timeout: 8000 })
  const freeze = async (label, ms, fracs) => {
    for (const f of fracs) {
      await page.evaluate((t) => document.getAnimations().forEach((a) => String(a.effect?.pseudoElement ?? '').startsWith('::view-transition') && (a.pause(), (a.currentTime = t))), f * ms)
      await shot(`${label}-${Math.round(f * 100)}`)
    }
    await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
  }
  for (const name of ['Your Name', 'The Mandalorian']) {
    const t = lib.titles.find((x) => x.name.startsWith(name))
    await page.evaluate((id) => (location.hash = `#/title/${id}`), t.id)
    await sleep(1800)
    await page.locator('.title-hero .btn.primary').click()
    await vtStarted()
    const nav = await page.evaluate(() => document.documentElement.dataset.nav)
    log(name, 'nav', nav)
    await freeze(name.split(' ').pop(), nav === 'expand' ? 560 : 820, [0.25, 0.6])
    await sleep(2000)
    await shot(`${name.split(' ').pop()}-player`)
    await page.keyboard.press('Escape')
    await sleep(1800)
  }
}
