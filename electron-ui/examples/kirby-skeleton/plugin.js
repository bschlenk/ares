import {
  bindCapture,
  describeCapture,
  matrix,
  readCapture,
  viewport,
} from './skeleton.js'

const COLORS = ['#ffd400', '#7cff4f', '#ff6bd6', '#ff8a3d', '#b18cff', '#fff']
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—'),
  vec = (v, d = 2) => v.map((x) => fmt(x, d)).join(', ')
const OBSERVER = `export default({emu,mem})=>({generation:emu.info().capture_generation,kirby:[mem.f32(0x800e25d0,'cpu'),mem.f32(0x800e2790,'cpu'),mem.f32(0x800e2950,'cpu')]})`

export function activate(ctx) {
  const opts = { overlay: true, labels: false, bones: true },
    hidden = new Set(),
    panels = new Set(),
    colors = new Map()
  let layer = null,
    canvas = null,
    last = null,
    cached = null,
    enabled = false,
    enabling = false,
    message = 'Waiting for verified RSP capture.',
    lastError = ''
  const request = async (method, params) => {
    const r = await ctx.services.request(method, params)
    if (!r.ok) throw Error(r.error?.code ?? r.error ?? 'request_failed')
    return r.result
  }
  const notify = () => {
    for (const render of panels) render()
  }
  const fail = (error) => {
    message = /busy/.test(String(error))
      ? 'Waiting: graphics capture or an exclusive tool is busy.'
      : String(error)
    if (
      String(error) !== lastError &&
      !/busy|stale_capture|stale_epoch|stale_plugin_scope|plugin_unloaded|disconnected/.test(
        String(error),
      )
    ) {
      lastError = String(error)
      ctx.log.error(lastError)
    }
    layer?.setVisible(false)
    notify()
  }
  const ensureCapture = async () => {
    if (enabled || enabling || ctx.signal.aborted) return
    enabling = true
    try {
      await request('n64.capture.control', { rsp: true, rdp: null })
      if (!ctx.signal.aborted) enabled = true
    } catch (error) {
      if (!ctx.signal.aborted) fail(error)
    } finally {
      enabling = false
    }
  }
  const colorOf = (o) => {
    if (o.name === 'Kirby') return '#00e5ff'
    if (!colors.has(o.seg4))
      {colors.set(o.seg4, COLORS[colors.size % COLORS.length])}
    return colors.get(o.seg4)
  }
  const draw = () => {
    if (!layer || !canvas || !last) return
    const current = last,
      size = layer.size,
      valid =
        size.logicalWidth === 320 &&
        size.logicalHeight === 240 &&
        size.sourceWidth === 640 &&
        size.sourceHeight === 240 &&
        size.geometry?.rotation === 0 &&
        size.geometry.cropX === 0 &&
        size.geometry.cropY === 0
    layer.setVisible(opts.overlay && valid && current.scene.matched)
    if (!valid) return
    layer.present(current.sample, () => {
      canvas.width = size.pixelWidth
      canvas.height = size.pixelHeight
      const g = canvas.getContext('2d')
      g.setTransform(size.pixelWidth / 320, 0, 0, size.pixelHeight / 240, 0, 0)
      g.clearRect(0, 0, 320, 240)
      g.lineWidth = 1
      g.font = '7px monospace'
      for (const o of current.scene.objects) {
        if (hidden.has(o.key)) continue
        g.strokeStyle = g.fillStyle = colorOf(o)
        if (opts.bones) {
          g.beginPath()
          for (const j of o.joints) {
            const p = o.joints[j.parent]?.screen
            if (j.screen && p) {
              g.moveTo(p.x, p.y)
              g.lineTo(j.screen.x, j.screen.y)
            }
          }
          g.stroke()
        }
        o.joints.forEach((j, i) => {
          if (!j.screen) return
          const { x, y } = j.screen
          if (Math.abs(x) > 10000 || Math.abs(y) > 10000) return
          g.beginPath()
          g.arc(x, y, j.parent < 0 ? 2 : 1.4, 0, Math.PI * 2)
          if (j.vertexBatches) g.fill()
          else g.stroke()
          if (opts.labels) g.fillText(String(i), x + 3, y - 2)
        })
      }
    })
  }
  ctx.ui.registerOverlay('skeletons', (overlay) => {
    layer = overlay
    canvas = document.createElement('canvas')
    canvas.className = 'kirby-skeleton-canvas'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    overlay.element.append(canvas)
    overlay.setVisible(false)
    const resize = overlay.onResize(draw)
    return () => {
      resize()
      layer = null
      canvas = null
    }
  })
  void ctx.storage.get('opts').then((saved) => {
    if (ctx.signal.aborted) return
    for (const key of Object.keys(opts))
      {if (typeof saved?.[key] === 'boolean') opts[key] = saved[key]}
    draw()
    notify()
  })
  ctx.scope.interval(() => {
    void ensureCapture()
  }, 100)
  ctx.scope.onFrame({ source: OBSERVER, boundary: 'vi' }, async (sample) => {
    if (ctx.signal.aborted) return
    if (!enabled) {
      await ensureCapture()
      return
    }
    try {
      if (!cached || cached.generation !== sample.value.generation)
        {cached = await readCapture(request, sample.value.generation)}
      if (ctx.signal.aborted) return
      if (!bindCapture(cached, sample)) {
        last = null
        layer?.setVisible(false)
        message = 'Waiting for a capture matching the displayed VI origin.'
        notify()
        return
      }
      const scene = describeCapture(cached, sample)
      last = { sample, scene, capture: cached }
      message =
        scene.reason ||
        `${scene.partial ? 'Partial capture. ' : ''}Scanout task candidates; projected joint origins.`
      draw()
      notify()
    } catch (error) {
      if (!ctx.signal.aborted) {
        last = null
        cached = null
        fail(error)
      }
    }
  })
  const exportValue = () => {
    const current = last
    if (!current) return null
    const shown = layer?.frame,
      presentation =
        shown &&
        shown.native_session === current.sample.frame.native_session &&
        shown.epoch === current.sample.frame.epoch &&
        shown.vi === current.sample.frame.vi &&
        shown.origin_commit === current.sample.frame.origin_commit
          ? shown
          : null
    const cam = current.scene.camera,
      joint =
        current.scene.objects.find((o) => o.name === 'Kirby')?.joints[0] ??
        current.scene.objects[0]?.joints[0]
    return {
      format: 'ares-kirby-skeleton-v2',
      frame: current.sample.frame.vi,
      screen: {
        width: 320,
        height: 240,
        note: 'framebuffer pixels, y down; projected joint origins',
      },
      frame_reference: current.sample.frame,
      capture_reference: current.capture.frame_reference,
      presentation_reference: presentation,
      generation: current.capture.generation,
      mapping: 'candidate_only',
      projection: 'derived_joint_origins',
      partial: current.scene.partial,
      capture_status: {
        committed: current.capture.committed,
        retained: current.capture.retained,
        dropped: current.capture.dropped,
        matrix_overflow: current.capture.matrix_overflow,
      },
      camera: cam
        ? {
            ...cam,
            persp: matrix(cam.perspective_raw),
            view: matrix(cam.view_raw),
            viewport: joint ? viewport(joint.viewportRaw) : null,
            convention: 'row vectors: clip = [x y z 1] * view * persp',
          }
        : null,
      objects: current.scene.objects.map((o) => ({
        ...o,
        joints: o.joints.map((j, node) => ({
          ...j,
          node,
          mesh: null,
          mesh_provenance: 'not_inferred_from_vertex_loads',
          screen: j.screen ? [j.screen.x, j.screen.y] : null,
          screen_point: j.screen,
        })),
      })),
    }
  }
  ctx.ui.registerPanel('skeletons', ({ element, signal }) => {
    element.classList.add('kirby-skeleton')
    element.innerHTML = `<div class="ks-head"><label><input type="checkbox" data-opt="overlay"> Overlay</label><label><input type="checkbox" data-opt="labels"> Labels</label><label><input type="checkbox" data-opt="bones"> Bones</label><button class="ks-copy">Copy frame JSON</button><button class="ks-save">Save frame JSON</button><span class="ks-frame"></span></div><h3>Camera (derived)</h3><dl class="ks-cam"></dl><h3>Captured skeletons</h3><table class="ks-objs"><thead><tr><th></th><th>object</th><th>joints</th><th>root (world)</th></tr></thead><tbody></tbody></table><p class="ks-status" role="status" aria-live="polite"></p>`
    for (const box of element.querySelectorAll('[data-opt]'))
      {ctx.scope.listen(box, 'change', () => {
        opts[box.dataset.opt] = box.checked
        void ctx.storage.set('opts', opts)
        draw()
        notify()
      })}
    const render = () => {
      for (const box of element.querySelectorAll('[data-opt]'))
        {box.checked = opts[box.dataset.opt]}
      element.querySelector('.ks-status').textContent = message
      element.querySelector('.ks-frame').textContent = last
        ? `VI ${last.sample.frame.vi} · capture ${last.capture.generation}`
        : 'No matching capture'
      element.querySelector('.ks-copy').disabled = element.querySelector(
        '.ks-save',
      ).disabled = !last
      const cam = last?.scene.camera,
        dl = element.querySelector('.ks-cam')
      dl.replaceChildren()
      for (const [key, value] of cam
        ? [
            ['eye', vec(cam.eye)],
            ['forward', vec(cam.fwd, 3)],
            ['up', vec(cam.up, 3)],
            ['yaw / pitch', `${fmt(cam.yaw)}° / ${fmt(cam.pitch)}°`],
            ['fov y / aspect', `${fmt(cam.fovy)}° / ${fmt(cam.aspect, 4)}`],
            ['near / far', `${fmt(cam.near)} / ${fmt(cam.far)}`],
          ]
        : [['camera', 'No verified perspective/look-at pair.']]) {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd')
        dt.textContent = key
        dd.textContent = value
        dl.append(dt, dd)
      }
      const tbody = element.querySelector('tbody')
      tbody.replaceChildren()
      for (const o of last?.scene.objects ?? []) {
        const row = document.createElement('tr'),
          checkCell = document.createElement('td'),
          check = document.createElement('input')
        check.type = 'checkbox'
        check.checked = !hidden.has(o.key)
        check.setAttribute('aria-label', `Show ${o.name}`)
        check.onchange = () => {
          if (check.checked) hidden.delete(o.key)
          else hidden.add(o.key)
          draw()
        }
        checkCell.append(check)
        row.append(checkCell)
        for (const value of [
          o.name,
          String(o.joints.length),
          vec(o.joints[0].world),
        ]) {
          const td = document.createElement('td')
          td.textContent = value
          row.append(td)
        }
        row.children[1].style.color = colorOf(o)
        row.children[3].className = 'ks-num'
        tbody.append(row)
      }
      element.dataset.epoch = String(last?.sample.frame.epoch ?? 0)
      element.dataset.generation = String(last?.capture.generation ?? 0)
      element.dataset.joints = String(
        last?.scene.objects.reduce((n, o) => n + o.joints.length, 0) ?? 0,
      )
      element.dataset.matched = String(!!last?.scene.matched)
      element.dataset.partial = String(!!last?.scene.partial)
    }
    panels.add(render)
    signal.addEventListener('abort', () => panels.delete(render), {
      once: true,
    })
    render()
    ctx.scope.listen(element.querySelector('.ks-copy'), 'click', async () => {
      const value = exportValue()
      if (!value) return
      try {
        await ctx.clipboard.writeText(JSON.stringify(value))
        message = `Copied VI ${value.frame_reference.vi}.`
        notify()
      } catch (error) {
        fail(error)
      }
    })
    ctx.scope.listen(element.querySelector('.ks-save'), 'click', async () => {
      const value = exportValue()
      if (!value) return
      try {
        const result = await ctx.exports.saveText({
          suggestedName: `kirby-frame-${value.frame_reference.vi}.json`,
          text: JSON.stringify(value, null, 1),
        })
        message =
          result.state === 'cancelled'
            ? 'Save cancelled.'
            : `Saved VI ${value.frame_reference.vi}.`
        notify()
      } catch (error) {
        fail(error)
      }
    })
  })
  ctx.ui.registerCommand('open', () => ctx.ui.openPanel('skeletons'))
  // Native ownership release on scope disposal stops only this plugin's capture.
}
