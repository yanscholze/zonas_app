export const WEEK_DAYS=['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
export function scheduledDays(preferred:string[],sessions:Record<string,{removed?:boolean}>):string[]{
  return WEEK_DAYS.filter(day=>!sessions[day]?.removed&&(preferred.includes(day)||Boolean(sessions[day])));
}
export function relocateWorkout<T extends {removed?:boolean}>(sessions:Record<string,T>,origin:string,destination:string,removed:T):Record<string,T>{
  if(!WEEK_DAYS.includes(origin)||!WEEK_DAYS.includes(destination)||origin===destination||!sessions[origin]||sessions[origin].removed)return sessions;
  return {...sessions,[destination]:sessions[origin],[origin]:sessions[destination]&&!sessions[destination].removed?sessions[destination]:removed};
}
