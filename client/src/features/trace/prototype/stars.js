// Tiny vector sprites; the browser interpolates their transforms independently of JS frames.
const STARS=[
  [7,22,.85],[12,78,.38],[17,14,.55],[23,86,.9],[28,36,.35],
  [32,69,.62],[37,20,.98],[41,83,.3],[46,46,.72],[50,12,.4],
  [55,76,.92],[59,29,.32],[64,88,.58],[68,16,.78],[72,57,.38],
  [77,80,.65],[82,12,.95],[87,73,.32],[92,23,.52],[96,84,.78]
];
export const starStyles=`
.starfield{position:absolute;display:block;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;z-index:0}
.starfield .star{position:absolute;display:block;width:8px;height:8px;will-change:transform;backface-visibility:hidden}
.starfield .star svg{display:block;width:8px;height:8px;overflow:visible}
.starfield[data-still] .star{left:var(--static-x)!important;top:var(--static-y)!important;will-change:auto}
`;
export function starTracks(width,height,count=20,speed=4.8){
  const span=height+16;
  return STARS.slice(0,count).map(([x,y,brightness],index)=>{
    const velocity=speed*(.6+(index%5)*.17),seedY=height*y/100;
    return {left:width*x/100-4-(seedY+8)*.28,top:-12,
      staticX:width*x/100-4,staticY:seedY-4,
      dx:span*.28,dy:span,duration:span/velocity*1000,
      delay:-(seedY+8)/velocity*1000,brightness,
      radius:.45+(.6+(index%5)*.17)*.32,halo:index===6||index===10};
  });
}
function registerStarfield(view){
  if(view.customElements.get('trace-starfield'))return;
  view.customElements.define('trace-starfield',class extends view.HTMLElement{
    connectedCallback(){
      this.motion=view.matchMedia('(prefers-reduced-motion: reduce)');
      this.sprites=[];this.animations=[];this.geometry='';
      const count=Number(this.getAttribute('count'))||20;
      this.replaceChildren();
      for(const [index,track] of starTracks(1,1,count).entries()){
        const star=this.ownerDocument.createElement('span');star.className='star';
        const halo=track.halo?3.5:2,id='halo-'+index;
        star.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" aria-hidden="true"><defs><radialGradient id="${id}"><stop stop-color="white" stop-opacity="${track.brightness*.22}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>${track.brightness>.7?`<circle cx="4" cy="4" r="${halo}" fill="url(#${id})"/>`:''}<circle cx="4" cy="4" r="${track.radius}" fill="white" opacity="${track.brightness}"/></svg>`;
        this.append(star);this.sprites.push(star);
      }
      this.resize=()=>{
        const width=this.clientWidth,height=this.clientHeight,key=width+':'+height;
        if(!width||!height||key===this.geometry)return;
        this.geometry=key;
        this.tracks=starTracks(width,height,count,Number(this.getAttribute('speed'))||4.8);
        this.applyTracks();
      };
      this.motionChange=()=>{
        if(this.motion.matches){this.cancelAnimations();this.setAttribute('data-still','');}
        else{this.removeAttribute('data-still');this.applyTracks();}
      };
      this.observer=new view.ResizeObserver(this.resize);this.observer.observe(this);
      this.motion.addEventListener('change',this.motionChange);this.resize();
    }
    applyTracks(){
      if(!this.tracks)return;
      this.toggleAttribute('data-still',this.motion.matches);
      this.tracks.forEach((track,index)=>{
        const star=this.sprites[index];
        star.style.left=track.left+'px';star.style.top=track.top+'px';
        star.style.setProperty('--static-x',track.staticX+'px');star.style.setProperty('--static-y',track.staticY+'px');
        if(this.motion.matches)return;
        const frames=[{transform:'translate3d(0,0,0)'},{transform:`translate3d(${track.dx}px,${track.dy}px,0)`}];
        const animation=this.animations[index];
        if(animation){
          const old=animation.effect.getTiming(),time=animation.currentTime;
          const phase=time===null?null:(time-old.delay)/old.duration;
          animation.effect.setKeyframes(frames);
          animation.effect.updateTiming({duration:track.duration,delay:track.delay});
          if(phase!==null)animation.currentTime=track.delay+phase*track.duration;
        }else this.animations[index]=star.animate(frames,{duration:track.duration,delay:track.delay,iterations:Infinity,easing:'linear'});
      });
    }
    cancelAnimations(){for(const animation of this.animations)animation.cancel();this.animations=[];}
    disconnectedCallback(){this.cancelAnimations();this.observer?.disconnect();this.motion?.removeEventListener('change',this.motionChange);}
  });
}
export function createStarfield(doc,count=20,speed=4.8){
  registerStarfield(doc.defaultView);
  const field=doc.createElement('trace-starfield');field.className='starfield';
  field.setAttribute('aria-hidden','true');field.setAttribute('count',count);field.setAttribute('speed',speed);
  return field;
}
