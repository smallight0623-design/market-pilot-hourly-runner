// Read-only query core; canonical projections must be supplied by a source-bound adapter.
export const weekMs=7*24*60*60*1000;
export function rollingWindow(now=Date.now()){if(!Number.isFinite(now))throw Error('invalid_query_time');return{start:new Date(now-weekMs).toISOString(),end:new Date(now).toISOString()};}
export function searchAccounts(rows,filters={},window=rollingWindow()){
 const start=Date.parse(window.start),end=Date.parse(window.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('invalid_window');
 const minWin=filters.minWinRate??null;if(minWin!==null&&(!Number.isFinite(minWin)||minWin<0||minWin>100))throw Error('invalid_win_rate');
 const required=[...new Set(filters.skinIds??[])];if(required.some(id=>typeof id!=='string'||!id))throw Error('invalid_skin_id');const counts={outsideWindow:0,ineligible:0,anomaly:0,unknown:0,noMatch:0};const results=[];
 for(const row of rows){
  let u;try{u=new URL(row.sourceUrl)}catch{counts.ineligible++;continue}
  const published=Date.parse(row.publishedAt);
  if(u.origin!=='https://www.8591.com.tw'||!/^\/v3\/mall\/detail\/\d+$/.test(u.pathname)||row.kind!=='sell_account'||row.eligibility!=='eligible'){counts.ineligible++;continue}
  if(!Number.isFinite(published)){counts.unknown++;continue}if(published<start||published>=end){counts.outsideWindow++;continue}
  if(row.priceAnomaly==='review'){counts.anomaly++;continue}
  if(minWin!==null&&row.winRate==null||filters.highRank&&row.currentRankLevel==null||filters.goodBinding&&(!row.binding||row.binding==='unknown')){counts.unknown++;continue}
  if(minWin!==null&&row.winRate<minWin||filters.highRank&&row.currentRankLevel<7||filters.goodBinding&&!['clean_transfer','fb_transfer'].includes(row.binding)){counts.noMatch++;continue}
  const ids=new Set(row.possibleSkinIds??[]);if(required.length&&!(filters.skinMode==='any'?required.some(id=>ids.has(id)):required.every(id=>ids.has(id)))){counts.noMatch++;continue}
  results.push(row);
 }
 results.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||String(a.id).localeCompare(String(b.id)));return{results,counts,total:results.length,window,ownershipVerified:false,warning:'符合已收錄文字／圖片辨識結果，不代表驗證持有或仍在售'};
}
