// Functional composer using the recovered controls and the existing starry surface.
import appearanceCSS from './pill-appearance.css?raw';
import {icon} from './icons.js';
import {createStarfield,starStyles} from './stars.js?rev=workspace-8';
import sourceHTML from './recovered-chatgpt/composer.scoped.html?raw';
import sourceCSS from './recovered-chatgpt/composer.resolved.css?raw';
function loadSource(){return Promise.resolve([sourceHTML,sourceCSS]);}
const SEND=icon('arrow-up');
const STOP=icon('square');
const STRUCTURE=[
  starStyles,
  ':host{display:block;height:auto;overflow:hidden;position:relative}:host(:not([ready])){visibility:hidden}.mount{width:768px;transform-origin:top left;position:relative;z-index:1}',
  '.error{color:#ffb8a4;font:12px system-ui}.error:empty{display:none}',
  '[data-composer-body]{width:100%!important;height:auto!important;min-height:46px!important;display:flex!important;flex-direction:column!important;box-sizing:border-box!important}',
  '.trace-layout{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:6px;padding:4px 8px;box-sizing:border-box;min-height:44px;width:100%}',
  '.trace-layout>[data-snapshot-node="11"]{grid-column:1;grid-row:1}',
  '.trace-editor{grid-column:2;grid-row:1;display:block;resize:none;box-sizing:border-box;width:100%;min-width:0;height:24px;max-height:144px;padding:0;margin:0;border:0;outline:none;background:transparent;color:#f4f3f1;font:500 16px/24px Arial,sans-serif;scrollbar-color:#454545 transparent;caret-color:#fff}',
  '.trace-editor::placeholder{color:rgba(255,255,255,.76)}',
  '.trace-tools{grid-column:3;grid-row:1;display:flex;align-items:center;gap:6px}',
  '.trace-detail{border:0;background:transparent;color:#ccc;font:15px Arial,sans-serif;width:78px;height:32px;padding:0 4px;cursor:pointer;color-scheme:dark}.trace-detail option{background:#171717;color:#eee}',
  '.trace-detail[hidden]{display:none!important}.trace-detail-button{display:flex;align-items:center;justify-content:center;gap:6px;width:auto;height:28px;padding:0 6px;border:0;border-radius:999px;background:transparent;color:#aaa;font:13px Arial,sans-serif;cursor:pointer;white-space:nowrap}.trace-detail-button:hover,.trace-detail-button[aria-expanded=true]{background:#ffffff0b;color:#eee}.trace-detail-button svg{width:12px;height:12px;flex-shrink:0}.trace-tools{gap:4px}',
  '.trace-detail-menu{position:fixed;inset:auto;margin:0;padding:5px;width:150px;border:1px solid #333;border-radius:12px;background:#131313;color:#eee;box-shadow:0 12px 32px #0009;font:13px Arial,sans-serif}.trace-detail-menu::backdrop{background:transparent}.trace-detail-option{display:flex;align-items:center;justify-content:space-between;width:100%;height:34px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:#bbb;font:13px Arial,sans-serif;text-align:left;cursor:pointer}.trace-detail-option:hover,.trace-detail-option:focus-visible{background:#262626;color:#fff;outline:none!important}.trace-detail-option[aria-selected=true]{color:#fff;background:#202020}.trace-detail-option svg{width:13px;height:13px;visibility:hidden}.trace-detail-option[aria-selected=true] svg{visibility:visible}',
  '[data-snapshot-node="57"]{color:#000!important;cursor:pointer}[data-snapshot-node="57"] svg{display:block;width:18px;height:18px;color:#000}[data-snapshot-node="57"]:disabled{opacity:.3;cursor:default}',
  'button:focus-visible,select:focus-visible{outline:2px solid #c7c7d1!important;outline-offset:2px}',
  ':host([expanded]) .trace-layout{grid-template-rows:auto 36px;padding:8px}:host([expanded]) .trace-editor{grid-column:1/-1;grid-row:1;width:calc(100% - 16px);margin:4px 8px}',
  ':host([expanded]) .trace-layout>[data-snapshot-node="11"]{grid-row:2}:host([expanded]) .trace-tools{grid-row:2}',
  '.trace-files{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 0}.trace-files:empty{display:none}',
  '.trace-file{display:flex;align-items:center;gap:8px;max-width:220px;padding:6px 9px;background:#171717;border:1px solid #303030;border-radius:10px;color:#ddd;font:12px Arial,sans-serif}',
  '.trace-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trace-file button{flex-shrink:0;border:0;background:transparent;color:#aaa;padding:0 2px;cursor:pointer;font:17px Arial,sans-serif}.trace-file-input{display:none}'
].join('');
export class ChatGptPill extends HTMLElement{
  constructor(){
    super();this.files=[];this.busy=false;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.attachShadow({mode:'open'}).innerHTML='<style id="recovered"></style><style id="appearance"></style><style>'+STRUCTURE+'</style><div class="mount"></div><div class="error" role="alert"></div>';
    this.mount=this.shadowRoot.querySelector('.mount');
  }
  async connectedCallback(){
    try{
      const [html,css]=await loadSource();if(!this.isConnected)return;
      this.shadowRoot.querySelector('#appearance').textContent=appearanceCSS;const stop=()=>{};
      if(!this.isConnected){stop();return;}
      this.shadowRoot.querySelector('#recovered').textContent=css;this.mount.innerHTML=html;
      this.buildComposer();
      this.stopLiveStyles=stop;this.observer=new ResizeObserver(()=>this.fit());this.observer.observe(this);this.fit();
      this.setAttribute('ready','');
      this.shadowRoot.querySelector('.error').textContent='';
      this.resolveReady();this.dispatchEvent(new CustomEvent('pill-ready'));
    }catch(error){
      this.shadowRoot.querySelector('.error').textContent='Preview unavailable. Waiting to reconnect…';
      if(this.isConnected)this.retryTimer=setTimeout(()=>this.connectedCallback(),1500);
    }
  }
  buildComposer(){
    this.body=this.mount.querySelector('[data-composer-body]');
    const add=this.mount.querySelector('[data-snapshot-node="11"]');
    this.mic=this.mount.querySelector('[data-snapshot-node="47"]');
    this.send=this.mount.querySelector('[data-snapshot-node="57"]');
    this.editor=document.createElement('textarea');this.editor.className='trace-editor';
    this.editor.placeholder='Ask TRACE';this.editor.setAttribute('aria-label','Ask TRACE');this.editor.rows=1;
    this.detail=document.createElement('select');this.detail.className='trace-detail';this.detail.setAttribute('aria-label','Response detail');
    for(const [value,label] of [['high','High'],['standard','Standard'],['brief','Brief']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;this.detail.append(option);
    }
    this.detail.hidden=true;this.detail.tabIndex=-1;this.detail.setAttribute('aria-hidden','true');
    this.detailButton=document.createElement('button');this.detailButton.type='button';this.detailButton.className='trace-detail-button';
    this.detailButton.setAttribute('aria-haspopup','listbox');this.detailButton.setAttribute('aria-expanded','false');this.detailButton.setAttribute('aria-controls','detail-menu');
    this.detailMenu=document.createElement('div');this.detailMenu.id='detail-menu';this.detailMenu.className='trace-detail-menu';this.detailMenu.setAttribute('popover','auto');
    this.detailMenu.setAttribute('role','listbox');this.detailMenu.setAttribute('aria-label','Response detail');
    for(const option of this.detail.options){
      const choice=document.createElement('button');choice.type='button';choice.className='trace-detail-option';choice.textContent=option.textContent;choice.insertAdjacentHTML('beforeend',icon('check'));choice.querySelector('svg').setAttribute('aria-hidden','true');choice.dataset.value=option.value;
      choice.setAttribute('role','option');choice.addEventListener('click',()=>{this.detail.value=choice.dataset.value;this.renderDetail();this.detailMenu.hidePopover();this.detailButton.focus();this.changed();});
      this.detailMenu.append(choice);
    }
    this.shadowRoot.append(this.detailMenu);
    this.detailButton.addEventListener('click',()=>this.openDetail());
    this.detailButton.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();this.openDetail(event.key==='ArrowUp'?-1:1);}});
    this.detailMenu.addEventListener('toggle',event=>this.detailButton.setAttribute('aria-expanded',String(event.newState==='open')));
    this.detailMenu.addEventListener('keydown',event=>{
      const choices=[...this.detailMenu.children],current=choices.indexOf(this.shadowRoot.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[index].focus();
      }else if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();this.detailMenu.hidePopover();this.detailButton.focus();}
    });
    this.renderDetail();
    this.fileList=document.createElement('div');this.fileList.className='trace-files';this.fileList.setAttribute('aria-label','Attachments');
    this.fileInput=document.createElement('input');this.fileInput.type='file';this.fileInput.multiple=true;this.fileInput.className='trace-file-input';this.fileInput.tabIndex=-1;
    const layout=document.createElement('div');layout.className='trace-layout';
    const tools=document.createElement('div');tools.className='trace-tools';tools.append(this.detail,this.detailButton,this.mic,this.send);
    layout.append(add,this.editor,tools);this.body.replaceChildren(createStarfield(document),this.fileList,layout,this.fileInput);this.mount.replaceChildren(this.body);
    this.editor.addEventListener('input',()=>{this.fit();this.updatePrimary();this.changed();});
    this.editor.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!this.busy)this.submit();}
    });
    this.send.addEventListener('click',()=>this.busy?this.emit('composer-stop'):this.submit());
    this.detail.addEventListener('change',()=>{this.renderDetail();this.changed();});
    add.addEventListener('click',()=>this.fileInput.click());
    this.fileInput.addEventListener('change',()=>{
      let rejected=false;
      for(const file of this.fileInput.files){
        if(file.size>20*1024*1024||this.files.length>=6){rejected=true;continue;}
        const id=file.name+':'+file.size+':'+file.lastModified;
        if(!this.files.some(item=>item.id===id))this.files.push({id,name:file.name,size:file.size,type:file.type});
      }
      this.fileInput.value='';this.renderFiles();this.fit();this.updatePrimary();this.changed();
      if(rejected)this.emit('composer-error','Attach up to six files, each smaller than 20 MB.');
      else if(this.files.length)this.emit('composer-error','File names are saved with the chat. File analysis requires a connected chat model.');
    });
    const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
    this.mic.setAttribute('aria-label','Dictate message');
    if(Recognition)this.mic.addEventListener('click',()=>this.dictate(Recognition));
    else{this.mic.disabled=true;this.mic.title='Dictation is unavailable in this browser';}
    this.updatePrimary();
  }
  emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail,bubbles:true,composed:true}));}
  changed(){this.emit('composer-change',{text:this.editor.value,files:this.files.map(file=>({...file})),detail:this.detail.value});}
  submit(){if(!this.busy&&(this.editor.value.trim()||this.files.length))this.emit('composer-submit',{text:this.editor.value.trim(),files:this.files.map(file=>({...file})),detail:this.detail.value});}
  get value(){return this.editor?.value||'';}
  renderDetail(){
    const label=this.detail.selectedOptions[0]?.textContent||'High';
    this.detailButton.innerHTML='<span></span>'+icon('chevron-down');this.detailButton.querySelector('svg').setAttribute('aria-hidden','true');
    this.detailButton.firstChild.textContent=label;this.detailButton.setAttribute('aria-label','Response detail: '+label);
    for(const choice of this.detailMenu.children){const selected=choice.dataset.value===this.detail.value;choice.setAttribute('aria-selected',String(selected));choice.tabIndex=selected?0:-1;}
  }
  openDetail(direction=0){
    if(this.detailMenu.matches(':popover-open')){this.detailMenu.hidePopover();return;}
    const rect=this.detailButton.getBoundingClientRect(),width=150,height=114,viewport=globalThis.visualViewport;
    const leftEdge=viewport?.offsetLeft||0,topEdge=viewport?.offsetTop||0;
    const rightEdge=leftEdge+(viewport?.width||innerWidth),bottomEdge=topEdge+(viewport?.height||innerHeight);
    this.detailMenu.style.left=Math.max(leftEdge+8,Math.min(rect.right-width,rightEdge-width-8))+'px';
    this.detailMenu.style.top=Math.max(topEdge+8,rect.bottom+height+8<bottomEdge?rect.bottom+8:rect.top-height-8)+'px';
    this.detailMenu.showPopover();this.detailButton.setAttribute('aria-expanded','true');
    const choices=[...this.detailMenu.children];(direction<0?choices.at(-1):choices.find(choice=>choice.dataset.value===this.detail.value)).focus();
  }
  setDraft(text='',files=[],detail='high'){
    this.stopDictation();this.editor.value=text;this.files=files.map(file=>({...file}));this.detail.value=detail;
    this.renderDetail();
    this.renderFiles();this.fit();this.updatePrimary();
  }
  renderFiles(){
    this.fileList.replaceChildren();
    for(const file of this.files){
      const chip=document.createElement('div');chip.className='trace-file';
      const name=document.createElement('span');name.textContent=file.name;name.title=file.name+' Â· '+Math.ceil(file.size/1024)+' KB';
      const remove=document.createElement('button');remove.type='button';remove.textContent='Ã—';remove.setAttribute('aria-label','Remove '+file.name);
      remove.addEventListener('click',()=>{this.files=this.files.filter(item=>item.id!==file.id);this.renderFiles();this.fit();this.updatePrimary();this.changed();this.focusInput();});
      chip.append(name,remove);this.fileList.append(chip);
    }
  }
  setBusy(value){this.busy=value;this.updatePrimary();}
  updatePrimary(){
    if(!this.send)return;this.send.innerHTML=this.busy?STOP:SEND;
    this.send.querySelector('svg').setAttribute('aria-hidden','true');
    this.send.disabled=!this.busy&&!this.editor.value.trim()&&!this.files.length;
    this.send.setAttribute('aria-label',this.busy?'Stop response':'Send message');
  }
  focusInput(){this.editor?.focus({preventScroll:true});}
  dictate(Recognition){
    if(this.recognition){this.stopDictation();return;}
    const recognition=new Recognition(),prefix=this.editor.value;this.recognition=recognition;
    recognition.lang=navigator.language;recognition.interimResults=false;
    recognition.onresult=event=>{this.editor.value=[prefix,event.results[0][0].transcript].filter(Boolean).join(' ');this.fit();this.updatePrimary();this.changed();};
    recognition.onerror=()=>this.emit('composer-error','Dictation could not start. Check microphone access.');
    recognition.onend=()=>{if(this.recognition===recognition)this.recognition=null;this.mic.setAttribute('aria-pressed','false');};
    try{recognition.start();this.mic.setAttribute('aria-pressed','true');}
    catch{this.recognition=null;this.emit('composer-error','Dictation is unavailable right now.');}
  }
  stopDictation(){this.recognition?.abort();this.recognition=null;this.mic?.setAttribute('aria-pressed','false');}
  disconnectedCallback(){clearTimeout(this.retryTimer);this.observer?.disconnect();this.stopLiveStyles?.();this.stopDictation();}
  fit(){
    if(!this.editor||!this.body||!this.isConnected)return;
    if(this.detailMenu?.matches(':popover-open'))this.detailMenu.hidePopover();
    // Scale the complete control surface with the viewport's short dimension.
    // Reflow its internal width independently so the horizontal length stays put.
    const scale=Math.min(1.4,Math.max(.85,Math.min(innerWidth,innerHeight)/720));
    const baseWidth=this.getBoundingClientRect().width/scale;
    this.mount.style.width=baseWidth+'px';
    this.removeAttribute('expanded');this.editor.style.height='0px';
    const expanded=this.editor.scrollHeight>26||this.files.length>0;
    this.toggleAttribute('expanded',expanded);this.editor.style.height='0px';
    this.editor.style.height=Math.min(144,Math.max(24,this.editor.scrollHeight))+'px';
    const height=this.body.offsetHeight*scale;
    this.mount.style.transform='scale('+scale+')';
    if(Math.abs((parseFloat(this.style.height)||0)-height)>.1)this.style.height=height+'px';
    this.body.querySelector('.starfield')?.resize?.();
  }
}
if(!customElements.get('chatgpt-pill'))customElements.define('chatgpt-pill',ChatGptPill);
