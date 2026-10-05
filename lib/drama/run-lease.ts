/** In-process ownership. Cross-replica ownership remains a separate gate. */
interface DramaLeases { active: Map<string, string>; starting: Set<string> }
// Next route bundles and development reloads must observe the same owner.
const globalLeases = globalThis as typeof globalThis & { __videoDramaLeases?: DramaLeases };
const leases = globalLeases.__videoDramaLeases ??= { active: new Map(), starting: new Set() };
const { active, starting } = leases;
export function isDramaRunActive(videoId: string): boolean { return active.has(videoId); }
export function isDramaWorkActive(videoId: string): boolean {
  return active.has(videoId) || starting.has(videoId);
}
export function reserveDramaStart(videoId: string): boolean {
  if (isDramaWorkActive(videoId)) return false;
  starting.add(videoId);
  return true;
}
export function releaseDramaStart(videoId: string): void { starting.delete(videoId); }
export function tryAcquireDramaRun(videoId: string, jobId: string): boolean {
  if (active.has(videoId)) return false;
  active.set(videoId, jobId);
  return true;
}
export function releaseDramaRun(videoId: string, jobId: string): void {
  if (active.get(videoId) === jobId) active.delete(videoId);
}
export function clearDramaRunLeases(): void { active.clear(); starting.clear(); }
