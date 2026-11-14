import test from 'node:test';
import assert from 'node:assert/strict';
import {nextUpcomingRace,daysUntilRace,raceDateLabel,saoPauloDate,validRaceDate} from '../shared/races.ts';

test('next race uses the nearest non-discarded calendar date, including today, regardless of array order',()=>{
 const races=[{id:'later',name:'Later',race_date:'2026-12-01',distance:'21 km'},
 {id:'discarded',race_date:'2026-11-14',status:'Descartada'},
 {id:'past',race_date:'2026-11-13'},
 {id:'next',race_date:'2026-11-15',status:'Aguardando análise'},
 {id:'invalid',race_date:'2026-11-31'},
 {id:'today',race_date:'2026-11-14',status:'Aprovada'}];
 const before=JSON.stringify(races);
 assert.equal(nextUpcomingRace(races,'2026-11-14').id,'today');
 assert.equal(nextUpcomingRace(races,'2026-11-15').id,'next');
 assert.equal(nextUpcomingRace(races,'2027-01-01'),undefined);
 assert.equal(JSON.stringify(races),before);
});

test('race dates retain Sao Paulo date across UTC midnight and calendar month/year boundaries',()=>{
 const today=saoPauloDate(new Date('2026-11-15T01:30:00Z'));
 assert.equal(today,'2026-11-14');assert.equal(daysUntilRace('2026-11-14',today),0);
 assert.equal(daysUntilRace('2026-12-01','2026-11-30'),1);
 assert.equal(daysUntilRace('2027-01-01','2026-12-31'),1);
 assert.equal(raceDateLabel('2026-11-14'),'14/11/2026');
 assert.equal(validRaceDate('2026-02-30'),false);assert.equal(validRaceDate('not-a-date'),false);
});
