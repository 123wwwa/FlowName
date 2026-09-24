/** Bound in-flight work; preserve input order and drain already-started work on stop. */
export async function mapConcurrent<T,R>(items:readonly T[],limit:number,work:(item:T,index:number)=>Promise<R>,shouldStop:()=>boolean=()=>false):Promise<Array<R|undefined>> {
  if(!Number.isSafeInteger(limit)||limit<1||limit>32)throw new Error('Concurrency must be an integer from 1 to 32.');
  const results:Array<R|undefined>=Array(items.length).fill(undefined);
  let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!shouldStop()&&cursor<items.length){const index=cursor++;results[index]=await work(items[index]!,index);}
  });
  // Drain all workers even when one has an unexpected I/O failure.
  const settled=await Promise.allSettled(workers);
  const failed=settled.find(r=>r.status==='rejected');
  if(failed?.status==='rejected')throw failed.reason;
  return results;
}

/** Serialize only journal writes, not model inference. A write failure remains fatal. */
export function serialWriter(write:(value:string)=>Promise<unknown>) {
  let tail:Promise<unknown>=Promise.resolve();
  return (value:string)=>{tail=tail.then(()=>write(value));return tail;};
}
