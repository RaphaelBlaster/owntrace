// Independent, reference-calibrated reconstruction. No image/video texture.
// The text mask is freshly typeset; all light is computed from that mask.
const FONT_URL = new URL('./sf-pro-display_medium.ttf', import.meta.url);
let fontReady;
function loadFont() {
  return fontReady ||= new FontFace('ProGlowSF', `url("${FONT_URL}")`, { weight: '500' })
    .load().then(font => document.fonts.add(font));
}

const SIZE = 391, CAP = 276, PAD = 320;
// Sigma is measured in reference-image pixels at a 276px cap height.
const LAYERS = [
  [1.6, [.039570,.167737,.343733], [0,0,0]],
  [4, [0,0,0], [.368979,.453807,.380210]],
  [9, [.104158,.409515,.514521], [.376663,.380903,.431320]],
  [18, [.357882,.320032,.126883], [.164915,.346795,.532528]],
  [36, [.764931,.584457,.422235], [0,.028190,.138624]],
  [108, [1.443920,.866011,.657133], [.764219,.902535,1.022491]],
  [160, [.701552,.321189,.247227], [.936210,.264199,.128281]],
];
const VERTEX = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 stepSize;
uniform float sigma;
uniform bool alphaSource;
in vec2 uv;
out vec4 color;
void main() {
  float sum = 0.0, weights = 0.0;
  for (int i = -14; i <= 14; ++i) {
    float weight = exp(-float(i*i) / (2.0 * sigma * sigma));
    vec4 sampleValue = texture(source, uv + float(i)*stepSize);
    sum += (alphaSource ? sampleValue.a : sampleValue.r) * weight;
    weights += weight;
  }
  color = vec4(sum / weights, 0.0, 0.0, 1.0);
}`;
const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D face;
${LAYERS.map((_, i) => `uniform sampler2D glow${i};`).join('\n')}
uniform float height, top, intensity;
in vec2 uv;
out vec4 color;
void main() {
  float y = (1.0 - uv.y) * height;
  float t = clamp((y - top) / ${CAP.toFixed(1)}, 0.0, 1.0);
  float a = texture(face, uv).r;
  vec3 light = vec3(0.0);
  ${LAYERS.map((layer, i) => `light += texture(glow${i},uv).r * mix(vec3(${layer[1].join(',')}),vec3(${layer[2].join(',')}),t);`).join('\n')}
  vec3 faceColor = mix(vec3(248.0,247.0,245.0),vec3(242.0,242.0,246.0),t)/255.0;
  vec3 rgb = clamp(faceColor*a + light*intensity*(1.0-a), 0.0, 1.0);
  // Premultiplied output preserves light on black without a baked black box.
  float opacity = max(a,max(rgb.r,max(rgb.g,rgb.b)));
  color = vec4(rgb,opacity);
}`;

function compile(gl, vertex, fragment) {
  const program = gl.createProgram(), shaders = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader); gl.deleteProgram(program);
      throw new Error(log);
    }
    shaders.push(shader); gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(log);
  }
  return program;
}

export class ProGlow extends HTMLElement {
  static observedAttributes = ['text', 'intensity', 'sharp'];
  constructor() {
    super();
    this.attachShadow({mode:'open'}).innerHTML = `
      <style>:host{display:block}canvas{display:block;width:100%;height:auto}p{color:#ffb8a4;font:14px system-ui;padding:20px}p:empty{display:none}</style>
      <canvas part="canvas"></canvas><p role="alert"></p>`;
    this.canvas = this.shadowRoot.querySelector('canvas');
    this.message = this.shadowRoot.querySelector('p');
    this.textures = [];
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.message.textContent = 'Graphics context lost. Waiting for recovery.';
      this.gl = null; this.renderKey = null; this.face = null;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.textures = []; this.gl = null; this.renderKey = null; this.schedule();
    });
  }
  connectedCallback() {
    this.setAttribute('role','img');
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this);
    this.schedule();
  }
  disconnectedCallback() {
    this.observer?.disconnect(); cancelAnimationFrame(this.pending);
    this.releaseTextures();
    if (this.gl) {
      this.gl.deleteProgram(this.blurProgram); this.gl.deleteProgram(this.compositeProgram);
      this.gl.deleteFramebuffer(this.framebuffer);
    }
    this.gl = null; this.renderKey = null; this.face = null;
  }
  attributeChangedCallback(name) {
    if (name === 'intensity' && this.gl && this.layout) this.composite();
    else this.schedule();
  }
  get text() { return this.getAttribute('text') || 'PRO'; }
  set text(value) { this.setAttribute('text',value); }
  getTextBounds() {
    const bounds=this.layout?.textBounds;
    if(!bounds)return null;
    const rect=this.canvas.getBoundingClientRect();
    return {
      left:rect.left+bounds.left*rect.width/this.layout.width,
      top:rect.top+bounds.top*rect.height/this.layout.height,
      width:bounds.width*rect.width/this.layout.width,
      height:bounds.height*rect.height/this.layout.height
    };
  }
  schedule() {
    if (!this.isConnected) return;
    cancelAnimationFrame(this.pending);
    this.pending = requestAnimationFrame(() => this.render());
  }
  setup() {
    if (this.gl) return;
    const gl = this.canvas.getContext('webgl2', {alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('This renderer needs WebGL 2 with floating-point render targets.');
    this.gl = gl;
    this.blurProgram = compile(gl, VERTEX, BLUR);
    this.compositeProgram = compile(gl, VERTEX, COMPOSITE);
    this.framebuffer = gl.createFramebuffer();
  }
  releaseTextures() {
    if (this.gl) this.textures.forEach(texture => this.gl.deleteTexture(texture));
    this.textures = [];
  }
  makeTexture(width, height) {
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.HALF_FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.textures.push(texture);
    return texture;
  }
  diffuse(source, sigma) {
    const gl=this.gl, p=this.blurProgram;
    const ratio = Math.min(1, 4/(sigma*this.layout.scale));
    const w=Math.max(2,Math.ceil(this.canvas.width*ratio));
    const h=Math.max(2,Math.ceil(this.canvas.height*ratio));
    const first=this.makeTexture(w,h), second=this.makeTexture(w,h);
    gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer); gl.viewport(0,0,w,h);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(p,'source'),0);
    for (const [input,output,horizontal] of [[source,first,true],[first,second,false]]) {
      gl.bindTexture(gl.TEXTURE_2D,input);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Cannot allocate a floating-point glow layer.');
      gl.uniform2f(gl.getUniformLocation(p,'stepSize'),horizontal?1/w:0,horizontal?0:1/h);
      gl.uniform1f(gl.getUniformLocation(p,'sigma'),sigma*(horizontal?w/this.layout.width:h/this.layout.height));
      gl.uniform1i(gl.getUniformLocation(p,'alphaSource'),horizontal?1:0);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.deleteTexture(first); this.textures.splice(this.textures.indexOf(first),1);
    return second;
  }
  async render() {
    try {
      await loadFont(); if (!this.isConnected) return;
      this.setup();
      const gl=this.gl, mask=document.createElement('canvas'), context=mask.getContext('2d');
      context.font=`500 ${SIZE}px ProGlowSF`;
      const glyphs=Array.from(this.text.slice(0,80)), positions=[];
      let cursor=0, left=Infinity, right=-Infinity, ascent=CAP, descent=0;
      let inkLeft=Infinity, inkRight=-Infinity, inkAscent=-Infinity, inkDescent=-Infinity;
      glyphs.forEach((glyph,i)=>{
        const metrics=context.measureText(glyph);
        positions.push(cursor);
        left=Math.min(left,cursor-metrics.actualBoundingBoxLeft);
        right=Math.max(right,cursor+metrics.actualBoundingBoxRight);
        ascent=Math.max(ascent,metrics.actualBoundingBoxAscent);
        descent=Math.max(descent,metrics.actualBoundingBoxDescent);
        if(metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight>0 &&
           metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent>0){
          inkLeft=Math.min(inkLeft,cursor-metrics.actualBoundingBoxLeft);
          inkRight=Math.max(inkRight,cursor+metrics.actualBoundingBoxRight);
          inkAscent=Math.max(inkAscent,metrics.actualBoundingBoxAscent);
          inkDescent=Math.max(inkDescent,metrics.actualBoundingBoxDescent);
        }
        // Tracking measured on the reference. RO is slightly tighter.
        cursor+=metrics.width-6-(glyph==='R'&&glyphs[i+1]==='O'?4:0);
      });
      const width=Math.ceil(Math.max(120,right-left)+PAD*2);
      const height=Math.ceil(ascent+descent+PAD*2);
      const cssWidth=Math.max(1,this.getBoundingClientRect().width);
      const scale=Math.min((cssWidth*Math.min(devicePixelRatio||1,2.5))/width,3200/width,2200/height);
      const targetWidth=Math.max(1,Math.round(width*scale));
      const targetHeight=Math.max(1,Math.round(height*scale));
      const key=`${this.text}|${targetWidth}|${targetHeight}|${this.hasAttribute('sharp')}`;
      if (key===this.renderKey) {this.composite();return;}
      this.renderKey=key;
      this.releaseTextures();
      this.canvas.width=mask.width=targetWidth; this.canvas.height=mask.height=targetHeight;
      const textBounds=Number.isFinite(inkLeft)
        ?{left:PAD-left+inkLeft,top:PAD+ascent-inkAscent,width:inkRight-inkLeft,height:inkAscent+inkDescent}
        :{left:width/2,top:height/2,width:0,height:0};
      this.layout={width,height,scale:targetWidth/width,top:PAD+ascent-CAP,textBounds};
      context.scale(targetWidth/width,targetHeight/height);
      context.font=`500 ${SIZE}px ProGlowSF`;context.fillStyle='white';context.textBaseline='alphabetic';
      glyphs.forEach((glyph,i)=>context.fillText(glyph,PAD-left+positions[i],PAD+ascent));
      const source=gl.createTexture(); this.textures.push(source);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);
      // Sharpen only the face; the diffusion layers retain their fitted radii.
      this.face=this.diffuse(source,this.hasAttribute('sharp')?.25:.7);
      this.layers=LAYERS.map(layer=>this.diffuse(source,layer[0]));
      this.setAttribute('aria-label',this.text);
      this.message.textContent=''; this.composite();
    } catch(error) {
      this.message.textContent=error.message; this.renderKey=null;
      console.error('ProGlow:',error);
    }
  }
  composite() {
    const gl=this.gl,p=this.compositeProgram;
    if(!gl||!this.face)return;
    gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    [this.face,...this.layers].forEach((texture,i)=>{
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.uniform1i(gl.getUniformLocation(p,i===0?'face':`glow${i-1}`),i);
    });
    const value=Number(this.getAttribute('intensity')??1);
    gl.uniform1f(gl.getUniformLocation(p,'intensity'),Number.isFinite(value)?Math.max(0,Math.min(3,value)):1);
    gl.uniform1f(gl.getUniformLocation(p,'height'),this.layout.height);
    gl.uniform1f(gl.getUniformLocation(p,'top'),this.layout.top);
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.dispatchEvent(new CustomEvent('glow-render',{detail:{text:this.text,width:this.canvas.width,height:this.canvas.height,textBounds:this.getTextBounds()}}));
  }
}
if(!customElements.get('pro-glow'))customElements.define('pro-glow',ProGlow);
