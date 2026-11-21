export async function updateIndexHealth({read,write}, event) {
  const previous=await read();
  const old=previous?.value;
  if(old?.startedAt >= event.startedAt) return;
  const value={version:1,startedAt:event.startedAt,finishedAt:event.finishedAt,
    consecutiveFailures:event.ok?0:(old?.consecutiveFailures??0)+1,
    status:event.ok?'ready':'failed',code:event.code??null};
  await write(value,previous?.etag);
}
