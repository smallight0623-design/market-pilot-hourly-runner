// Fixed classifications only: never return private log text or exception messages.
export function runtimeFailure(exitCode,tail=''){
 const code=/^\d{1,3}$/.test(String(exitCode??''))?Number(exitCode):null;
 const heap=/FATAL ERROR:.*(?:heap limit|Allocation failed|JavaScript heap out of memory)|Reached heap limit/i.test(tail);
 return {event:'hourly_health',status:'diagnostic_unavailable',exitCode:code,
  runtimeFailure:heap?'node_heap_exhausted':code===134?'process_aborted':code===137?'process_killed':code===null?'unknown':'process_failed'};
}
