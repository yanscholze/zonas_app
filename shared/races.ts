export type AthleteRace = {
  id: string; name: string; race_date: string; distance: string;
  city?: string | null; goal?: string | null; priority?: string; status?: string;
};

export function saoPauloDate(now:Date):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validRaceDate(value:string):boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
}

/** Dates are calendar dates in Sao Paulo, never parsed as local midnight. */
export function nextUpcomingRace(races:AthleteRace[],today:string):AthleteRace|undefined {
  return races.filter(race=>race.status!=="Descartada"&&validRaceDate(race.race_date)&&race.race_date>=today)
    .sort((a,b)=>a.race_date.localeCompare(b.race_date)||a.id.localeCompare(b.id))[0];
}

export const raceDateLabel=(value:string)=>validRaceDate(value)?value.split("-").reverse().join("/"):"Data não informada";
export const daysUntilRace=(date:string,today:string)=>Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000);
