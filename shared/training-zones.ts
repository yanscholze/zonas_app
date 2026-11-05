export type PaceZone={z:string;label:string;slow:number;fast:number;source?:'individual'|'default'};
export function validPaceZone(value:unknown):value is PaceZone{
 const zone=value as PaceZone|null;
 return Boolean(zone&&typeof zone.z==='string'&&Number.isFinite(zone.slow)&&Number.isFinite(zone.fast)&&zone.fast>=120&&zone.slow<=1200&&zone.fast<=zone.slow);
}
export function parsePaceZones(value:unknown):PaceZone[]{
 try{const rows=typeof value==='string'?JSON.parse(value):value;return Array.isArray(rows)?rows.filter(validPaceZone):[]}catch{return[]}
}
export function effectivePaceZones(individual:unknown,defaults:unknown):PaceZone[]{
 const merged=new Map<string,PaceZone>();
 for(const zone of parsePaceZones(defaults))merged.set(zone.z.toUpperCase(),{...zone,source:'default'});
 for(const zone of parsePaceZones(individual))merged.set(zone.z.toUpperCase(),{...zone,source:'individual'});
 return [...merged.values()];
}
