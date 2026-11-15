const icons: Record<string,string> = {
  'Game Boy Advance':'game-boy-advance', 'Game Boy Color':'game-boy-color', 'Game Boy':'game-boy',
  'Super Famicom':'snes', 'Famicom':'nes', 'Nintendo 64':'n64', 'Nintendo - Nintendo 64':'n64',
  'Mega Drive':'mega-drive', 'Master System':'master-system', 'Game Gear':'game-gear',
  'PlayStation':'playstation', 'Saturn':'saturn', 'GameCube':'gamecube', 'Nintendo DS':'nintendo-ds',
};
/** Reuse the bundled controls plugin's system artwork and extraction provenance. */
export function updateWindowTitle(snapshot: import('../sessions/presentation.js').WindowPresentation): void {
  const {title,system,gameTitle}=snapshot;
  document.title=title;
  document.getElementById('window-game-title')!.textContent = title;
  const icon = document.getElementById('window-system-icon') as HTMLImageElement;
  const name = Object.keys(icons).find(name => system === name || system.startsWith(name + ' ('));
  const source = name ? new URL(`bundled-plugins/controls/assets/systems/${icons[name]}.png`, document.baseURI).href : '';
  icon.hidden = !source || !gameTitle;
  if (source && icon.src !== source) icon.src = source;
  icon.title = system;
}
