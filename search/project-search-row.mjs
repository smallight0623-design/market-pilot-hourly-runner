// Projection is deliberately separate from the cloud snapshot: no original row writes.
export function projectSearchRow(row,{library,model,tiers,ranks,listingGate,mergePossibleResources,fixedResources,bindingClass,sourceAttribute}){
 const reject=reason=>({excluded:{id:row.id,reason}});let url;try{url=new URL(row.sourceUrl)}catch{return reject('invalid_source')}
 if(url.origin!=='https://www.8591.com.tw'||!/^\/v3\/mall\/detail\/\d+$/.test(url.pathname)||url.pathname.split('/').at(-1)!==String(row.id))return reject('not_8591_account_source');
 const gate=listingGate(row);if(gate.status!=='eligible_for_recognition')return reject(gate.code);
 if(row.priceType!=='full_purchase_claim'||!Number.isFinite(row.askingPrice)||row.askingPrice<=0)return reject('not_fixed_full_price');
 if(!row.analysis)return reject('missing_analysis');
 const dt=row.detail??{},publishedAt=dt.publicationEvidence?.intervalEnd??(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(dt.postedAt??'')?dt.postedAt.replace(' ','T')+'+08:00':null);
 if(!Number.isFinite(Date.parse(publishedAt)))return reject('publication_time_unknown');
 const analysis=mergePossibleResources(row.analysis,row,library,{separateSellerResources:true}),review=analysis.possibleResourceReview;
 if(review?.sourceContentHash!==row.contentHash)return reject('resource_source_hash_mismatch');
 const resources=(review.resources??[]).filter(g=>g.type==='skin'&&library.entries.some(e=>e.enabled&&e.type==='skin'&&e.id===g.libraryId&&e.name===g.name));
 const norm=s=>String(s??'').replace(/[\s·・]/g,'');const seller=sourceAttribute(dt.description??'','段位');const sellerRank=ranks.find(e=>norm(e.name)===norm(seller));const current=sellerRank?.name??analysis.cardView?.currentRank??null;const rank=ranks.findIndex(e=>norm(e.name)===norm(current));
 const pricedNames=new Set((tiers.skinRules??[]).filter(r=>(tiers.tiers??[]).some(t=>t.id===r.tier&&t.unitTwd>0)).map(r=>r.name));
 const binding=bindingClass(row,model);const skinIds=[...new Set(resources.map(g=>g.libraryId))];
 return{row:{id:String(row.id),sourceUrl:url.origin+url.pathname,title:String(row.title??row.id).slice(0,240),kind:'sell_account',eligibility:'eligible',publishedAt,priceTwd:row.askingPrice,winRate:fixedResources(row).winRate??null,currentRank:current,currentRankLevel:rank<0?null:rank+1,currentRankSource:sellerRank?'seller_structured_attribute':'saved_image_or_text_result',binding,bindingLabel:({clean_transfer:'無綁無連',fb_transfer:'可移交／換綁',id_locked:'受限綁定'})[binding]??'未知',possibleSkinIds:skinIds,valuableSkinIds:resources.filter(g=>pricedNames.has(g.name)).map(g=>g.libraryId),resourceEvidence:resources.map(g=>({id:g.libraryId,name:g.name,sources:g.evidence.map(e=>({source:e.source,imageIndex:e.imageIndex,sourceSha256:e.sourceSha256,matchedText:e.matchedText}))})),sourceContentHash:row.contentHash,checkedAt:row.observedAt??dt.observedAt??null,recognitionVersion:'official_saved_result_with_current_text_merge',ownershipVerified:false,priceAnomaly:'not_assessed'}};
}
