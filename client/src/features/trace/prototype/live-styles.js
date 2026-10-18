// The static preview server needs a client-side watcher for in-place CSS updates.
export async function loadLiveStyles(url,target,{
  live=['localhost','127.0.0.1','[::1]'].includes(globalThis.location?.hostname),
  interval=750,onUpdate=()=>{}
}={}){
  let stopped=false,timer,controller,current;
  async function refresh(){
    controller=new AbortController();
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(`Cannot load preview styles: ${response.status}`);
    const css=await response.text();
    if(stopped||css===current)return;
    target.textContent=css;
    current=css;
    onUpdate();
  }
  async function poll(){
    try{if(!globalThis.document?.hidden)await refresh();}
    catch{/* Retain the last working styles and retry after transient save/network errors. */}
    if(!stopped)timer=setTimeout(poll,interval);
  }
  await refresh();
  if(live)timer=setTimeout(poll,interval);
  return ()=>{stopped=true;clearTimeout(timer);controller?.abort();};
}
