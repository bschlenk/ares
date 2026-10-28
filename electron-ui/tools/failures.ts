/** Errors remain structured at the CLI boundary instead of JSON in a message. */
export class ToolFailure extends Error {
  constructor(public code:string, message:string, public details?:unknown) { super(message); }
}
export function failureValue(error:unknown) {
  if(error instanceof ToolFailure)return {error:{code:error.code,message:error.message,...(error.details===undefined?{}:{details:error.details})}};
  const e=error as NodeJS.ErrnoException;
  return {error:{code:typeof e?.code==='string'?e.code:'operation_failed',message:error instanceof Error?error.message:String(error)}};
}
