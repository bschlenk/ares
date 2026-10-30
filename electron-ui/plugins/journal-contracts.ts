export const JOURNAL_LIMITS={bytes:4*1024*1024,records:32768,recordBytes:16384,pageBytes:65536,pending:16} as const;
export interface JournalRecord<T=unknown>{sequence:number;stream:string;id:string;schemaVersion:number;value:T}
export interface JournalAppend {id:string;schemaVersion:number;value:unknown}
export interface JournalReceipt {sequence:number;duplicate:boolean;bytes:number;quotaBytes:number}
export interface JournalPage<T=unknown>{records:JournalRecord<T>[];cursor:number;hasMore:boolean;nextSequence:number;bytes:number;quotaBytes:number}
