export interface LibraryGame {
  id: string;
  title: string;
  filename: string;
  system: string;
}
export interface LibrarySnapshot {
  directory: string;
  games: LibraryGame[];
  warnings: string[];
}
export type ArtworkKind = 'box' | 'cartridge';
export interface LibraryAPI {
  cached(): Promise<LibrarySnapshot | null>;
  scan(): Promise<LibrarySnapshot>;
  artwork(id: string, kind?: ArtworkKind): Promise<string | null>;
  launch(id: string): Promise<void>;
  chooseDirectory(): Promise<void>;
  openFile(): Promise<void>;
  contextMenu(id: string): Promise<void>;
}
export type LibraryRequest =
  | { operation: 'cached' | 'scan' | 'chooseDirectory' | 'openFile' }
  | { operation: 'launch' | 'contextMenu'; id: string }
  | { operation: 'artwork'; id: string; kind: ArtworkKind };
