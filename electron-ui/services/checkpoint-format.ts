/** A deliberately small, platform-independent strftime subset. */
export const DEFAULT_CHECKPOINT_FORMAT = '%b %e, %Y @ %I:%M %p';
export const CHECKPOINT_FORMAT_PRESETS = [DEFAULT_CHECKPOINT_FORMAT, '%Y-%m-%d %H:%M:%S %z', '%a, %b %e @ %I:%M %p'] as const;
export const CHECKPOINT_DIRECTIVES = '%YymBbd eHIMSpaz'.replaceAll(' ', '');
const pad = (n: number) => String(n).padStart(2, '0');
export function validateCheckpointFormat(format: string): string | null {
  if (!format.trim()) return 'Enter a date format.';
  if (format.length > 256 || /[\u0000-\u001f\u007f]/.test(format)) return 'Use at most 256 printable characters.';
  for (let i = 0; i < format.length; i++) if (format[i] === '%') {
    const directive = format[++i];
    if (!directive || !CHECKPOINT_DIRECTIVES.includes(directive)) return `Unsupported directive: %${directive ?? ''}`;
  }
  return null;
}
export function localOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;
}
export function checkpointStem(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_capture_time');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}${localOffset(date)}`;
}
export function formatCheckpoint(date: Date, format = DEFAULT_CHECKPOINT_FORMAT): string {
  const error = validateCheckpointFormat(format);
  if (error) throw new Error(error);
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const values: Record<string, string> = {
    '%':'%', Y:String(date.getFullYear()), y:pad(date.getFullYear() % 100), m:pad(date.getMonth()+1),
    b:month[date.getMonth()]!, B:months[date.getMonth()]!, d:pad(date.getDate()), e:String(date.getDate()),
    H:pad(date.getHours()), I:pad(date.getHours()%12 || 12), M:pad(date.getMinutes()), S:pad(date.getSeconds()),
    p:date.getHours()<12?'AM':'PM', a:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]!, z:localOffset(date),
  };
  return format.replace(/%(.)/g, (_, directive: string) => values[directive]!);
}
