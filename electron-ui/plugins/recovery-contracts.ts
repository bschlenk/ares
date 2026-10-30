export interface RecoveryNamespace {pluginId:string;storageVersion:number}
export interface RecoveryPoint {id:string;gameHash:string;sourceSession:string;sourceEpoch:number;frame:number;frameKind:string;capturedAt:number;journalSequence:number;captureMs:number}
export interface RecoveryStatus {monitoring:boolean;intervalMs?:number;point:RecoveryPoint|null;ageMs:number|null;framesSincePoint:number|null;lastError?:string;restored?:{pointId:string;journalSequence:number;targetSession:string;at:number}}
export type RecoveryOperation='status'|'capture'|'start'|'stop';
