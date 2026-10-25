export interface TextExport {suggestedName:string;text:string;overwrite?:boolean}
export interface FrameExport {suggestedName:string;source:string;args?:unknown;boundary?:'vi'|'vi_origin';every?:number;maxFrames?:number;maxBytes?:number;maxSeconds?:number;overwrite?:boolean}
export interface ExportStatus {jobId:string;pluginId:string;state:'choosing'|'recording'|'finishing'|'committed'|'cancelled'|'failed';kind:'text'|'frames';frames:number;bytes:number;lost:number;reason?:string;artifact?:{path:string;bytes:number;sha256:string}}
export interface RecordingExport {readonly jobId:string;stop():Promise<ExportStatus>;cancel():Promise<ExportStatus>}
