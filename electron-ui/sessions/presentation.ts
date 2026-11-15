
export interface WindowPresentation {
  revision: number;
  instance: string;
  kind: 'personal' | 'named';
  sessionName?: string;
  title: string;
  gameTitle?: string;
  system: string;
  access: {state:'unapproved'|'pending'|'authorized'|'revoking'; implicit:boolean; instance:string; game_title?:string};
}
/** Main owns both native and custom titles, independently of native identities. */
export function formatWindowTitle(sessionName?: string, gameTitle?: string): string {
  return [sessionName, gameTitle, 'ares'].filter(Boolean).join(' — ');
}
