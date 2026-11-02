export function activate(ctx) {
  ctx.ui.registerPanel('dashboard', ({element}) => {
    const dashboard = document.createElement('div');
    Object.assign(dashboard.style, {display: 'grid', gridTemplateColumns: '3fr 1fr', width: '100%', height: '100%', minHeight: '180px', gap: '12px'});
    const picture = document.createElement('div'), commentary = document.createElement('aside');
    picture.style.minHeight = '0'; picture.style.minWidth = '0';
    const title = document.createElement('h2'); title.textContent = 'Native game video';
    const text = document.createElement('p'); text.textContent = 'Place your commentary, party, poll or atlas here. Ares owns the game image and audio.';
    commentary.append(title, text); dashboard.append(picture, commentary); element.append(dashboard);
    ctx.video.mount(picture, {fit: 'contain', filtering: 'nearest', integerScale: true});
  });
  ctx.ui.registerCommand('open', () => ctx.ui.openPanel('dashboard', {width: 1000, height: 650}));
}
