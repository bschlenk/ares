export function activate(context) {
  context.ui.registerCommand('open', () => context.ui.openPanel('browser', { width: 920, height: 620 }));
  context.ui.registerPanel('browser', ({ element, signal, onVisibility }) => {
    const viewGroup = `rom-view-${crypto.randomUUID()}`;
    element.innerHTML = `<section class="rom-library">
      <button data-folder hidden>Choose ROM folder…</button>
      <div class="rom-toolbar">
        <input type="search" aria-label="Search games" placeholder="Search games…" autofocus>
        <select aria-label="Filter by system" data-system><option value="">All systems</option></select>
        <select aria-label="Sort games" data-sort><option value="title">Title</option><option value="system">System</option></select>
        <div class="rom-view-control" role="radiogroup" aria-label="Library view" data-view-control>
          <label title="Cover flow"><input type="radio" name="${viewGroup}" value="flow" aria-label="Cover flow" checked><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 4h8v16H8zM4 7H2v10h2M20 7h2v10h-2"/></svg></label>
          <label title="Grid"><input type="radio" name="${viewGroup}" value="grid" aria-label="Grid"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg></label>
        </div>
      </div>
      <p class="rom-status" role="status"></p>
      <div class="rom-covers" data-view="flow" aria-label="Games"></div>
    </section>`;
    const root = element.querySelector('.rom-library');
    const actions = document.createElement('div'); actions.className = 'rom-header-actions';
    const icon = path => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path d="${path}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    actions.innerHTML = `<button class="modal-icon-button" data-refresh aria-label="Refresh games" title="Refresh games">${icon('M21 14a5.5 5.5 0 1 0 .4 4M21 10v4h-4')}</button><button class="modal-icon-button" data-file aria-label="Open file…" title="Open file…">${icon('M9 22V10h5l2 3h7v3M9 22h12l3-6H12L9 22Z')}</button>`;
    element.closest('dialog').querySelector('.modal-header-actions').prepend(actions);
    const find = selector => root.querySelector(selector) ?? actions.querySelector(selector);
    const covers = find('.rom-covers'), message = find('.rom-status'), search = find('input');
    const system = find('[data-system]'), sort = find('[data-sort]'), view = find('[data-view-control]');
    const viewMode = () => view.querySelector('input:checked').value;
    let games = [], filtered = [], selected = null, version = 0, loading = false, disposed = false;
    let observer, queue = [], active = 0, visible = false;
    const cards = new Map();
    const alive = () => !signal.aborted && !context.signal.aborted && !disposed;
    const report = error => { if (alive()) message.textContent = String(error); };
    const attempt = run => { void Promise.resolve().then(run).catch(report); };
    let viewChanged = false, viewWrites = Promise.resolve();
    const viewReady = context.storage.get('view').then(saved => {
      if (alive() && !viewChanged && ['flow', 'grid'].includes(saved)) view.querySelector(`input[value="${saved}"]`).checked = true;
    }).catch(report);
    function select(id, scroll = false, animate = true) {
      const previous = selected && cards.get(selected.id);
      previous?.classList.remove('selected'); previous?.setAttribute('aria-pressed', 'false');
      if (previous) previous.tabIndex = -1;
      selected = filtered.find(game => game.id === id) ?? null;
      const card = selected && cards.get(selected.id);
      if (card) {
        card.classList.add('selected'); card.setAttribute('aria-pressed', 'true');
        card.tabIndex = 0;
        if (scroll) card.scrollIntoView({ behavior: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant', block: 'nearest', inline: 'center' });
      }
    }
    async function play() {
      if (!selected) return;
      context.ui.closePanel('browser');
      try { await context.library.launch(selected.id); }
      catch (error) { if (alive()) context.ui.openPanel('browser'); throw error; }
    }
    function pump() {
      // Prioritize the currently visible covers when a fast scroll overtakes preloads.
      const bounds = covers.getBoundingClientRect();
      const distance = item => {
        const rect = item.image.closest('.rom-card').getBoundingClientRect();
        return Math.max(bounds.left - rect.right, 0, rect.left - bounds.right) + Math.max(bounds.top - rect.bottom, 0, rect.top - bounds.bottom);
      };
      queue.sort((a, b) => distance(a) - distance(b));
      while (active < 4 && queue.length && alive() && visible) {
        const { game, image, generation } = queue.shift();
        if (generation !== version) continue;
        ++active;
        void context.library.artwork(game.id).then(async source => {
          if (!alive() || generation !== version || !source) return;
          if (image.getAttribute('src') === source) return;
          const replacement = new Image(); replacement.src = source;
          await replacement.decode();
          if (!alive() || generation !== version) return;
          image.src = source;
          image.hidden = false;
          image.previousElementSibling.hidden = true;
        }).catch(() => {}).finally(() => { --active; pump(); });
      }
    }
    function render() {
      const focused = covers.contains(document.activeElement);
      ++version; observer?.disconnect(); queue = [];
      const query = search.value.trim().toLocaleLowerCase();
      filtered = games.filter(game => (!system.value || game.system === system.value) &&
        `${game.title} ${game.filename} ${game.system}`.toLocaleLowerCase().includes(query));
      filtered.sort((a, b) => (sort.value === 'system' ? a.system.localeCompare(b.system) : 0) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) || a.filename.localeCompare(b.filename));
      covers.dataset.view = viewMode();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          const game = filtered.find(game => game.id === entry.target.dataset.id);
          if (game) queue.push({ game, image: entry.target.querySelector('img'), generation: version });
        }
        pump();
      }, { root: covers, rootMargin: '800px 1600px' });
      let position = 0;
      const place = card => {
        const current = covers.children[position++];
        if (current !== card) covers.insertBefore(card, current ?? null);
        observer.observe(card);
      };
      for (const game of filtered) {
        const existing = cards.get(game.id);
        if (existing) { place(existing); continue; }
        const card = document.createElement('button');
        card.className = 'rom-card'; card.dataset.id = game.id;
        card.tabIndex = -1;
        card.setAttribute('aria-pressed', 'false');
        card.title = `${game.filename}\n${game.system}`;
        const art = document.createElement('span'); art.className = 'rom-art';
        const placeholder = document.createElement('span'); placeholder.className = 'rom-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        const image = document.createElement('img'); image.alt = `${game.title} box art`; image.hidden = true;
        image.onerror = () => { image.hidden = true; placeholder.hidden = false; };
        art.append(placeholder, image);
        const title = document.createElement('span'); title.textContent = game.title;
        const label = document.createElement('small'); label.textContent = game.system;
        card.append(art, title, label);
        card.onclick = () => { select(game.id); card.focus({ preventScroll: true }); };
        card.oncontextmenu = event => { event.preventDefault(); select(game.id); card.focus({ preventScroll: true }); attempt(() => context.library.contextMenu(game.id)); };
        card.onfocus = () => { if (selected?.id !== game.id) select(game.id); };
        card.ondblclick = () => { select(game.id); attempt(play); };
        card.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); select(game.id); attempt(play); } };
        cards.set(game.id, card); place(card);
      }
      const visible = new Set(filtered.map(game => game.id));
      for (const card of [...covers.children]) if (!visible.has(card.dataset.id)) card.remove();
      select(filtered.some(game => game.id === selected?.id) ? selected.id : filtered[0]?.id);
      if (focused) (selected ? cards.get(selected.id) : search)?.focus({ preventScroll: true });
      message.textContent = games.length ? `${filtered.length} of ${games.length} games` :
        'No games found. Choose a folder containing ROMs or ZIPs, or use Open file for discs and companion media.';
    }
    let lastSnapshot, refreshPending = false;
    function applySnapshot(snapshot) {
      lastSnapshot = snapshot;
      games = snapshot.games;
      const present = new Set(games.map(game => game.id));
      for (const id of cards.keys()) if (!present.has(id)) cards.delete(id);
      find('[data-folder]').hidden = Boolean(snapshot.directory);
      const previous = system.value; system.replaceChildren(new Option('All systems', ''));
      for (const name of [...new Set(games.map(game => game.system))].sort()) system.add(new Option(name, name));
      if ([...system.options].some(option => option.value === previous)) system.value = previous;
      render();
      if (snapshot.warnings.length) message.textContent += ' · ' + snapshot.warnings.join(' · ');
    }
    async function refresh(force = false) {
      if (!alive()) return;
      if (loading) { refreshPending ||= force; return; }
      loading = true; find('[data-refresh]').disabled = true;
      try {
        const [cached] = await Promise.all([context.library.cached(), viewReady]);
        if (!alive()) return;
        if (cached && !lastSnapshot) applySnapshot(cached);
        const snapshot = await context.library.scan();
        if (!alive()) return;
        if (force || JSON.stringify(snapshot) !== JSON.stringify(lastSnapshot)) applySnapshot(snapshot);
      } finally {
        loading = false;
        if (alive()) { find('[data-refresh]').disabled = false; if (refreshPending) { refreshPending = false; attempt(() => refresh(true)); } }
      }
    }
    search.oninput = render; system.onchange = render; sort.onchange = render;
    search.onkeydown = event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (selected) { select(selected.id, true, false); cards.get(selected.id)?.focus({preventScroll: true}); }
    };
    view.onchange = () => {
      viewChanged = true; render();
      const mode = viewMode();
      viewWrites = viewWrites.catch(() => {}).then(() => context.storage.set('view', mode));
      attempt(() => viewWrites);
    };
    find('[data-refresh]').onclick = () => attempt(() => refresh(true));
    find('[data-folder]').onclick = () => attempt(async () => { await context.library.chooseDirectory(); await refresh(); });
    find('[data-file]').onclick = () => attempt(() => context.library.openFile());
    function move(delta, animate = true) {
      const index = filtered.findIndex(game => game.id === selected?.id);
      select(filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))]?.id, true, animate);
      if (selected) cards.get(selected.id)?.focus({ preventScroll: true });
    }
    context.scope.listen(element.closest('dialog') ?? root, 'keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [role="combobox"]')) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const row = [...covers.children].findIndex(card => card.offsetTop > covers.firstElementChild?.offsetTop);
      const step = viewMode() === 'grid' && row > 0 && ['ArrowUp', 'ArrowDown'].includes(event.key) ? row : 1;
      move(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -step : step, !event.repeat);
    });
    context.scope.listen(covers, 'scroll', pump);
    let directory;
    const unwatch = context.settings.changed(snapshot => {
      const next = snapshot.entries.find(entry => entry.descriptor.id === 'library.directory')?.value;
      find('[data-folder]').hidden = Boolean(next);
      const changed = directory !== undefined && directory !== next;
      directory = next;
      if (changed) { refreshPending ||= loading; attempt(refresh); }
    });
    onVisibility(value => {
      visible = value;
      if (visible) { if (lastSnapshot) render(); attempt(refresh); }
      else { observer?.disconnect(); queue = []; }
    });
    attempt(refresh);
    return () => { disposed = true; ++version; observer?.disconnect(); queue = []; cards.clear(); unwatch(); actions.remove(); root.remove(); };
  });
}
