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
  await page.waitForFunction(() => document.getAnimations().some((a) => a.effect?.pseudoElement === '::view-transition-group(flick-play)'), null, { timeout: 8000 })
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
  await waitNav('leave').catch(async (e) => {
    log('leave never started', await page.evaluate(() => [location.hash, document.documentElement.dataset.nav, !!document.querySelector('.player'), document.activeElement?.tagName]))
    throw e
  })
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
  await waitNav('page').catch(async (e) => {
    log('no page transition', await page.evaluate(() => [location.hash, document.documentElement.dataset.nav, scrollY]))
    throw e
  })
  await freeze('to-title', 320, [0.15, 0.5])
  await sleep(1200)
  await shot('title-page')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitNav('expand')
  await freeze('expand', 560, [0.3, 0.7])
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

// Rough handling: double presses, input mid-animation, rapid navigation, key spam in the player.
// Uses The Mandalorian and Your Name only.
export async function chaos(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const mando = lib.titles.find((x) => x.name.includes('Mandalorian'))
  const yn = lib.titles.find((x) => x.name.startsWith('Your Name'))
  const issues = []
  const hash = () => page.evaluate(() => location.hash)
  const settle = async (label, want) => {
    await sleep(1800)
    const s = await page.evaluate(() => ({
      hash: location.hash,
      nav: document.documentElement.dataset.nav ?? null,
      named: [...document.querySelectorAll('[style*="view-transition-name"]')].map((e) => e.className),
      idle: document.body.classList.contains('p-idle'),
      player: !!document.querySelector('.player'),
      err: document.querySelector('.p-msg')?.textContent ?? null,
    }))
    const bad = []
    if (want && !(want instanceof RegExp ? want.test(s.hash) : s.hash === want)) bad.push(`hash ${s.hash}, wanted ${want}`)
    if (s.nav) bad.push(`transition stuck (${s.nav})`)
    if (s.named.length) bad.push(`leftover transition names on ${s.named}`)
    if (s.idle && !s.player) bad.push('player idle class left on body')
    if (s.err) bad.push(`player error: ${s.err}`)
    log(label, bad.length ? 'PROBLEM ' + bad.join('; ') : 'ok', s.hash)
    if (bad.length) {
      issues.push(`${label}: ${bad.join('; ')}`)
      await shot(label)
    }
  }
  const go = async (h) => {
    await page.evaluate((x) => (location.hash = x), h)
    await sleep(900)
  }

  // 1. Esc while the player is still opening
  await go('#/movies')
  await go(`#/title/${mando.id}`)
  await page.locator('.ep').first().click()
  await sleep(150)
  await page.keyboard.press('Escape')
  await settle('esc-while-opening', `#/title/${mando.id}`)

  // 2. Esc twice quickly
  await page.locator('.ep').first().click()
  await sleep(3000)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await settle('double-esc', `#/title/${mando.id}`)

  // 3. scroll right after leaving the player
  await page.locator('.ep').nth(1).click()
  await sleep(3000)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.documentElement.dataset.nav === 'leave', null, { timeout: 8000 })
  await sleep(120)
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 600 }))
    scrollBy(0, 600)
  })
  const t0 = Date.now()
  await page.waitForFunction(() => !document.documentElement.dataset.nav, null, { timeout: 5000 })
  log('transition ended', Date.now() - t0, 'ms after scrolling')
  await settle('scroll-while-returning', `#/title/${mando.id}`)
  await page.evaluate(() => scrollTo(0, 0))

  // 4. double click Back on a title page
  await go('#/movies')
  await go(`#/title/${yn.id}`)
  await page.locator('.back').dblclick()
  await settle('double-back', '#/movies')

  // 5. tab spam
  await page.getByRole('button', { name: 'Shows', exact: true }).click()
  await sleep(40)
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await sleep(40)
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await settle('tab-spam', '#/')
  const ind = await page.evaluate(() => document.querySelector('.nav-ind')?.parentElement?.textContent)
  if (ind !== 'Home') issues.push(`tab underline on ${ind}`)

  // 6. key spam in the player
  await go(`#/title/${mando.id}`)
  await page.locator('.ep').nth(2).click()
  await sleep(3500)
  const before = Number(await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow'))
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await sleep(4000)
  const after = Number(await page.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuenow'))
  const v = await page.locator('video').evaluate((el) => ({ paused: el.paused, t: el.currentTime, ready: el.readyState }))
  log('arrow x8', before, '->', after, JSON.stringify(v))
  if (after - before < 70 || after - before > 95) issues.push(`8 skips moved ${after - before}s`)
  if (v.paused) issues.push('video paused after space twice')
  await settle('key-spam', /^#\/play\//)

  // 7. menu open/close, then next-episode spam
  await page.keyboard.press('c')
  await sleep(200)
  await page.keyboard.press('Escape')
  await sleep(300)
  if (!(await hash()).startsWith('#/play/')) issues.push('Esc with the menu open left the player')
  await page.keyboard.press('n')
  await sleep(60)
  await page.keyboard.press('n')
  await sleep(60)
  await page.keyboard.press('n')
  await sleep(4000)
  const v2 = await page.locator('video').evaluate((el) => ({ paused: el.paused, t: el.currentTime }))
  log('after n x3', await hash(), JSON.stringify(v2))
  if (!(v2.t > 0.5)) issues.push('next-episode spam left the video not playing')
  await settle('next-spam', /^#\/play\//)

  // 8. resize mid-transition
  await page.keyboard.press('Escape')
  await sleep(1500)
  await go('#/')
  await page.getByRole('button', { name: 'Movies', exact: true }).click()
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2400, 1200))
  await settle('resize-mid-transition', '#/movies')
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(3440, 1392))

  log('ISSUES', issues.length ? '\n  ' + issues.join('\n  ') : 'none')
}

export async function chaos2(ctx) {
  const { page, shot, sleep, log, app } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const mando = lib.titles.find((x) => x.name.includes('Mandalorian'))
  const issues = []
  const state = () => page.evaluate(() => ({ hash: location.hash, nav: document.documentElement.dataset.nav ?? null, err: document.querySelector('.p-msg')?.textContent ?? null }))
  const expect = async (label, ok, extra = '') => {
    log(label, ok ? 'ok' : 'PROBLEM', extra)
    if (!ok) {
      issues.push(`${label} ${extra}`)
      await shot(label)
    }
  }

  // a. click the player's Back button while it is still opening
  await page.evaluate((id) => (location.hash = `#/title/${id}`), mando.id)
  await sleep(1500)
  await page.locator('.ep').first().click()
  await sleep(300)
  await page.mouse.move(200, 200)
  await page.getByRole('button', { name: 'Back' }).first().click().catch((e) => log('back click failed', e.message.split('\n')[0]))
  await sleep(2000)
  let s = await state()
  await expect('back-while-opening', s.hash === `#/title/${mando.id}` && !s.nav, JSON.stringify(s))

  // b. click another episode while the way back is still animating
  await page.locator('.ep').nth(1).click()
  await sleep(3000)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.documentElement.dataset.nav === 'leave', null, { timeout: 8000 })
  await sleep(100)
  const want = await page.locator('.ep').nth(3).getAttribute('data-file')
  await page.locator('.ep').nth(3).click({ force: true })
  await sleep(3500)
  s = await state()
  await expect('click-during-return', s.hash === `#/play/${want}` && !s.nav, JSON.stringify(s))

  // c. drag the seek bar, overshooting both ends
  const bar = page.getByRole('slider', { name: 'Seek' })
  await page.mouse.move(400, 400)
  const b = await bar.boundingBox()
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x - 300, b.y, { steps: 5 })
  await page.mouse.move(b.x + b.width + 300, b.y, { steps: 5 })
  await page.mouse.move(b.x + b.width * 0.4, b.y, { steps: 5 })
  await page.mouse.up()
  await sleep(3000)
  const dur = Number(await bar.getAttribute('aria-valuemax'))
  const now = Number(await bar.getAttribute('aria-valuenow'))
  await expect('seek-drag', Math.abs(now - dur * 0.4) < dur * 0.02 + 5, `${now} of ${dur}, wanted ~${Math.round(dur * 0.4)}`)

  // d. settings menu: Find more subtitles keeps a capped, scrolling list; Esc closes the menu only
  await page.mouse.move(600, 600)
  await page.mouse.move(640, 620)
  await page.getByRole('button', { name: 'Player settings' }).click()
  await page.getByText('Find more subtitles').click()
  await sleep(1500)
  const m = await page.evaluate(() => {
    const menu = document.querySelector('.menu')
    const list = document.querySelector('.mlist')
    return { menuH: menu?.getBoundingClientRect().height, list: !!list, listMax: list ? getComputedStyle(list).maxHeight : null, vh: innerHeight, text: menu?.textContent?.slice(0, 120) }
  })
  log('find view', JSON.stringify(m))
  await shot('find-subs')
  await expect('menu-height', m.menuH < m.vh * 0.8, `${m.menuH}px of ${m.vh}`)
  await page.keyboard.press('Escape')
  await sleep(300)
  s = await state()
  await expect('esc-closes-menu', s.hash.startsWith('#/play/') && !(await page.locator('.menu').count()), JSON.stringify(s))

  // e. resize while playing
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 900))
  await sleep(1200)
  const fit = await page.locator('video').evaluate((el) => ({ w: el.getBoundingClientRect().width, vw: innerWidth, t: el.style.transform }))
  await shot('player-small-window')
  await expect('resize-while-playing', Math.abs(fit.vw - 1600) < 40, JSON.stringify(fit))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(3440, 1392))
  await sleep(800)

  // f. search typed fast, open the first result
  await page.keyboard.press('Escape')
  await sleep(1500)
  await page.evaluate(() => (location.hash = '#/search'))
  await sleep(600)
  await page.getByLabel('Search your library').pressSequentially('mand', { delay: 15 })
  await sleep(500)
  await page.locator('.poster').first().click()
  await sleep(1500)
  s = await state()
  await expect('search-open', s.hash === `#/title/${mando.id}`, JSON.stringify(s))
  // F typed in search must not toggle fullscreen (handled by the search box), checked by the key not being swallowed
  await page.evaluate(() => (location.hash = '#/search'))
  await sleep(600)
  await page.getByLabel('Search your library').fill('')
  await page.getByLabel('Search your library').press('f')
  const typed = await page.getByLabel('Search your library').inputValue()
  await expect('f-in-search', typed === 'f', `box has "${typed}"`)

  log('ISSUES', issues.length ? '\n  ' + issues.join('\n  ') : 'none')
}

// Right-click menus, removing from rows with Undo, and a film's return into its Play button.
export async function menus(ctx) {
  const { page, shot, sleep, log } = ctx
  await page.locator('.header').waitFor({ timeout: 30000 })
  await sleep(1500)
  const issues = []
  const check = (label, ok, extra = '') => (log(label, ok ? 'ok' : 'PROBLEM', extra), ok || issues.push(`${label} ${extra}`))
  const items = () => page.locator('.cmenu [role=menuitem]').allInnerTexts()

  // Continue watching: remove, then undo
  const card = page.locator('[data-row=resume] .thumb', { hasText: 'Mandalorian' })
  await card.click({ button: 'right' })
  await sleep(250)
  log('card menu', JSON.stringify(await items()))
  await shot('menu-card')
  await page.getByRole('menuitem', { name: 'Remove from Continue watching' }).click()
  await sleep(600)
  check('removed from continue', (await card.count()) === 0)
  await shot('toast')
  await page.locator('.toast button', { hasText: 'Undo' }).click()
  await sleep(600)
  check('undo brings it back', (await card.count()) === 1)

  // Recently added: remove, then undo
  const poster = page.locator('[data-row=recent] .poster', { hasText: 'Your Name' })
  await poster.scrollIntoViewIfNeeded()
  await poster.click({ button: 'right' })
  await sleep(250)
  log('poster menu', JSON.stringify(await items()))
  await page.getByRole('menuitem', { name: 'Remove from Recently added' }).click()
  await sleep(600)
  check('removed from recent', (await poster.count()) === 0)
  await page.locator('.toast button', { hasText: 'Undo' }).click()
  await sleep(600)
  check('undo recent', (await poster.count()) === 1)

  // empty space, then Esc closes
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(300)
  await page.mouse.click(1500, 300, { button: 'right' })
  await sleep(250)
  log('page menu', JSON.stringify(await items()))
  await shot('menu-page')
  await page.keyboard.press('Escape')
  await sleep(200)
  check('esc closes', (await page.locator('.cmenu').count()) === 0)

  // in the player: Esc closes the menu and stays in the player
  const lib = await page.evaluate(() => window.flick.invoke('library:get'))
  const mando = lib.titles.find((x) => x.name.includes('Mandalorian'))
  await page.evaluate((id) => (location.hash = `#/title/${id}`), mando.id)
  await sleep(1500)
  await page.locator('.ep').nth(4).click({ button: 'right' })
  await sleep(250)
  log('episode menu', JSON.stringify(await items()))
  await page.getByRole('menuitem', { name: /^(Play|Resume)$/ }).click()
  await sleep(3500)
  await page.mouse.click(1500, 600, { button: 'right' })
  await sleep(250)
  log('player menu', JSON.stringify(await items()))
  await shot('menu-player')
  await page.keyboard.press('Escape')
  await sleep(400)
  check('esc in player menu stays', (await page.evaluate(() => location.hash)).startsWith('#/play/'))
  await page.keyboard.press('Escape')
  await sleep(1800)

  // a film: back shrinks into the Play button, the banner stays put
  const yn = lib.titles.find((x) => x.name.startsWith('Your Name'))
  await page.evaluate((id) => (location.hash = `#/title/${id}`), yn.id)
  await sleep(1500)
  await page.locator('.title-hero .btn.primary').click()
  await sleep(3000)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getAnimations().some((a) => String(a.effect?.pseudoElement ?? '') === '::view-transition-group(flick-play)'), null, { timeout: 8000 })
  for (const f of [0.4, 0.8]) {
    await page.evaluate((t) => document.getAnimations().forEach((a) => String(a.effect?.pseudoElement ?? '').startsWith('::view-transition') && (a.pause(), (a.currentTime = t))), f * 620)
    await shot(`film-back-${f * 100}`)
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
  await sleep(1500)

  // text box menu
  await page.evaluate(() => (location.hash = '#/search'))
  await sleep(700)
  await page.getByLabel('Search your library').click({ button: 'right' })
  await sleep(250)
  log('input menu', JSON.stringify(await items()))
  await page.keyboard.press('Escape')
  log('ISSUES', issues.length ? '\n  ' + issues.join('\n  ') : 'none')
}
