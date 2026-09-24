import test from 'node:test';
import assert from 'node:assert/strict';
import {mapConcurrent,serialWriter} from '../dist/concurrency.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('worker pool overlaps requests, enforces limit and returns in original order',async()=>{
  let active=0,peak=0;const seen=[];
  const result=await mapConcurrent([0,1,2,3,4,5],3,async(value)=>{
    active++;peak=Math.max(peak,active);seen.push(value);await delay(value===0?25:2);active--;return value*10;
  });
  assert.equal(peak,3);assert.equal(active,0);assert.equal(new Set(seen).size,6);
  assert.deepEqual(result,[0,10,20,30,40,50]);
  await assert.rejects(()=>mapConcurrent([],0,async()=>0),/Concurrency/);
});
test('circuit stop prevents new starts and drains all in-flight responses',async()=>{
  let stop=false,active=0;const started=[];
  const result=await mapConcurrent([0,1,2,3,4,5],3,async(value)=>{
    started.push(value);active++;await delay(value===0?1:15);if(value===0)stop=true;active--;return value;
  },()=>stop);
  assert.deepEqual(started,[0,1,2]);assert.equal(active,0);
  assert.deepEqual(result,[0,1,2,undefined,undefined,undefined]);
});
test('journal records stay ordered and do not overlap while inference may overlap',async()=>{
  let writing=false;const log=[];
  const write=serialWriter(async value=>{assert.equal(writing,false);writing=true;await delay(2);log.push(JSON.parse(value));writing=false;});
  await Promise.all(Array.from({length:16},(_,id)=>write(JSON.stringify({id}))));
  assert.deepEqual(log.map(r=>r.id),Array.from({length:16},(_,id)=>id));
});
