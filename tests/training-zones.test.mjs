import test from 'node:test';
import assert from 'node:assert/strict';
import {effectivePaceZones,parsePaceZones} from '../shared/training-zones.ts';
test('individual ranges override teacher defaults and malformed ranges are not invented',()=>{
 const defaults=[{z:'Z1',label:'Padrão',fast:360,slow:420},{z:'Z2',label:'Padrão',fast:300,slow:360}];
 const personal=[{z:'Z1',label:'Individual',fast:400,slow:480}];
 const zones=effectivePaceZones(JSON.stringify(personal),JSON.stringify(defaults));
 assert.equal(zones.find(z=>z.z==='Z1').fast,400);assert.equal(zones.find(z=>z.z==='Z1').source,'individual');
 assert.equal(zones.find(z=>z.z==='Z2').source,'default');assert.equal(zones.find(z=>z.z==='Z2').fast,300);
 assert.deepEqual(effectivePaceZones([],undefined),[]);assert.deepEqual(parsePaceZones('invalid'),[]);
 assert.deepEqual(parsePaceZones([{z:'Z1',fast:400,slow:300}]),[]);
 assert.equal(zones.some(z=>z.z==='Livre'||z.z==='Z0'),false);
});
