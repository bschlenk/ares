/** Local metadata contract, deliberately separate from native game methods. */
export interface InstanceMetadata {
  instance: string; kind: 'personal' | 'named'; session_id?: string; session_name?: string;
  opened_order: number; ready: boolean; loaded: boolean; running: boolean; paused: boolean;
  game_title?: string; system?: string; approval: 'required' | 'authorized' | 'implicit';
}
export type ManagementRequest = {operation: 'app_status'};
