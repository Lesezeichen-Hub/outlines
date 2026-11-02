(function(root){
  "use strict";
  function create(canvas){
    const gl=canvas.getContext("webgl",{antialias:true,preserveDrawingBuffer:true});
    let map=null,settings=null,vertices=null,count=0,wireCount=0,contourCount=0,program=null,buffer=null,wireBuffer=null,contourBuffer=null,angle=-.65,tilt=.75,zoom=1,panX=0,panY=0,material="light",light=45,showGrid=false,showContours=false,slice=1;
    if(gl){
      const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      try{
        program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,"attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 normal; varying float z; varying vec2 uv; void main(){gl_Position=m*vec4(p,1.);normal=n;z=p.z;uv=p.xy;}"));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,"precision mediump float; varying vec3 normal; varying float z; varying vec2 uv; uniform vec3 base; uniform vec3 sun; uniform float mode; uniform float zBase; uniform float zSpan; uniform float zCut; void main(){if(z>zCut)discard;float d=max(.0,dot(normalize(normal),normalize(sun)));float h=clamp((z-zBase)/max(zSpan,.001),0.,1.);vec3 c=mode>0.5?mix(vec3(.18,.31,.56),vec3(.88,.57,.22),h):base;if(mode<.5)c*=.96+.04*sin(uv.x*110.+sin(uv.y*31.)*2.);c*=.42+.58*d;gl_FragColor=vec4(c,1.);}"));gl.linkProgram(program);buffer=gl.createBuffer();wireBuffer=gl.createBuffer();contourBuffer=gl.createBuffer();
      }catch(e){console.warn("Relief WebGL:",e);program=null;}
    }
    function mesh(){if(!map)return;const w=map.width,h=map.height,step=Math.max(1,Math.ceil(Math.max(w,h)/140)),v=[],scale=2/Math.max(settings.widthMm,settings.heightMm),z=(x,y)=>(settings.thicknessMm-settings.reliefMm+map.values[y*w+x])*scale,pos=(x,y)=>[(x/(w-1)-.5)*settings.widthMm*scale,(.5-y/(h-1))*settings.heightMm*scale,z(x,y)],tri=(a,b,c)=>{const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],q=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],n=[u[1]*q[2]-u[2]*q[1],u[2]*q[0]-u[0]*q[2],u[0]*q[1]-u[1]*q[0]],l=Math.hypot(...n)||1;for(const p of [a,b,c])v.push(...p,...n.map(t=>t/l));},bottom=(x,y)=>{const q=pos(x,y);q[2]=0;return q;};
      for(let y=0;y<h-1;y+=step)for(let x=0;x<w-1;x+=step){const xx=Math.min(w-1,x+step),yy=Math.min(h-1,y+step),a=pos(x,y),b=pos(xx,y),c=pos(xx,yy),d=pos(x,yy),e=bottom(x,y),f=bottom(xx,y),g=bottom(xx,yy),k=bottom(x,yy);tri(a,b,c);tri(a,c,d);tri(e,g,f);tri(e,k,g);}
      for(let x=0;x<w-1;x+=step){const xx=Math.min(w-1,x+step);tri(pos(x,0),pos(xx,0),bottom(xx,0));tri(pos(x,0),bottom(xx,0),bottom(x,0));tri(pos(xx,h-1),pos(x,h-1),bottom(x,h-1));tri(pos(xx,h-1),bottom(x,h-1),bottom(xx,h-1));}
      for(let y=0;y<h-1;y+=step){const yy=Math.min(h-1,y+step);tri(pos(0,yy),pos(0,y),bottom(0,y));tri(pos(0,yy),bottom(0,y),bottom(0,yy));tri(pos(w-1,y),pos(w-1,yy),bottom(w-1,yy));tri(pos(w-1,y),bottom(w-1,yy),bottom(w-1,y));}
      vertices=new Float32Array(v);count=v.length/6;if(gl&&program){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);const wire=[];for(let i=0;i<v.length;i+=18){const a=v.slice(i,i+6),b=v.slice(i+6,i+12),c=v.slice(i+12,i+18);wire.push(...a,...b,...b,...c,...c,...a);}wireCount=wire.length/6;gl.bindBuffer(gl.ARRAY_BUFFER,wireBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(wire),gl.STATIC_DRAW);const lines=[],linePoint=(q,level)=>[(q[0]/(w-1)-.5)*settings.widthMm*scale,(.5-q[1]/(h-1))*settings.heightMm*scale,(settings.thicknessMm-settings.reliefMm+level)*scale+.002,0,0,1];const interval=Math.max(.5,settings.reliefMm/8);for(let level=interval;level<=settings.reliefMm+1e-6;level+=interval)for(const segment of root.ReliefCore.contours(map,level))lines.push(...linePoint(segment[0],level),...linePoint(segment[1],level));contourCount=lines.length/6;gl.bindBuffer(gl.ARRAY_BUFFER,contourBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(lines),gl.STATIC_DRAW);}draw();
    }
    function matrix(){const ca=Math.cos(angle),sa=Math.sin(angle),ct=Math.cos(tilt),st=Math.sin(tilt),s=.77*zoom;return new Float32Array([ca*s,sa*ct*s,sa*st*s,0,-sa*s,ca*ct*s,ca*st*s,0,0,-st*s,ct*s,0,panX,panY,0,1]);}
    function fallback(){const ctx=canvas.getContext("2d");if(!ctx||!map)return;ctx.fillStyle="#242820";ctx.fillRect(0,0,canvas.width,canvas.height);const m=matrix(),project=p=>({x:(m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]+1)*canvas.width/2,y:(1-(m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]))*canvas.height/2});for(let i=0;i<vertices.length;i+=18){const cut=(settings.thicknessMm-settings.reliefMm+settings.reliefMm*slice)*2/Math.max(settings.widthMm,settings.heightMm)+.003;if(Math.max(vertices[i+2],vertices[i+8],vertices[i+14])>cut)continue;const p=[0,6,12].map(j=>project(vertices.slice(i+j,i+j+3)));ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);ctx.lineTo(p[1].x,p[1].y);ctx.lineTo(p[2].x,p[2].y);ctx.closePath();ctx.fillStyle=material==="dark"?"#694b31":material==="gray"?"#999b96":"#c79c60";ctx.fill();if(material==="wire"||showGrid){ctx.strokeStyle="#3d3326";ctx.stroke();}}}
    function drawContoursFallback(){
      const ctx=canvas.getContext("2d"),m=matrix(),w=map.width,h=map.height,scale=2/Math.max(settings.widthMm,settings.heightMm),interval=Math.max(.5,settings.reliefMm/8);
      ctx.strokeStyle="#332014";ctx.lineWidth=1;ctx.beginPath();
      for(let level=interval;level<=settings.reliefMm*slice+1e-6;level+=interval)for(const [a,b] of root.ReliefCore.contours(map,level)){
        const project=q=>{const x=(q[0]/(w-1)-.5)*settings.widthMm*scale,y=(.5-q[1]/(h-1))*settings.heightMm*scale,z=(settings.thicknessMm-settings.reliefMm+level)*scale+.003;return[(m[0]*x+m[4]*y+m[8]*z+m[12]+1)*canvas.width/2,(1-(m[1]*x+m[5]*y+m[9]*z+m[13]))*canvas.height/2];};
        ctx.moveTo(...project(a));ctx.lineTo(...project(b));
      }
      ctx.stroke();
    }
    function draw(){
      if(!map||!vertices)return;
      if(!gl||!program){fallback();if(showContours)drawContoursFallback();return;}
      gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.12,.14,.11,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(program);
      const p=gl.getAttribLocation(program,"p"),n=gl.getAttribLocation(program,"n");gl.enableVertexAttribArray(p);gl.enableVertexAttribArray(n);
      const bind=target=>{gl.bindBuffer(gl.ARRAY_BUFFER,target);gl.vertexAttribPointer(p,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(n,3,gl.FLOAT,false,24,12);};
      gl.uniformMatrix4fv(gl.getUniformLocation(program,"m"),false,matrix());
      const base=material==="dark"?[.43,.27,.14]:material==="gray"?[.7,.72,.7]:[.77,.57,.32];gl.uniform3fv(gl.getUniformLocation(program,"base"),base);
      gl.uniform3fv(gl.getUniformLocation(program,"sun"),[Math.cos(light*Math.PI/180),Math.sin(light*Math.PI/180),1]);
      const scale=2/Math.max(settings.widthMm,settings.heightMm),zBase=(settings.thicknessMm-settings.reliefMm)*scale;
      gl.uniform1f(gl.getUniformLocation(program,"zBase"),zBase);gl.uniform1f(gl.getUniformLocation(program,"zSpan"),settings.reliefMm*scale);gl.uniform1f(gl.getUniformLocation(program,"zCut"),zBase+settings.reliefMm*scale*slice+.003);
      gl.uniform1f(gl.getUniformLocation(program,"mode"),material==="height"?1:0);
      if(material!=="wire"){bind(buffer);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.drawArrays(gl.TRIANGLES,0,count);gl.disable(gl.POLYGON_OFFSET_FILL);}
      if(material==="wire"||showGrid){bind(wireBuffer);gl.uniform1f(gl.getUniformLocation(program,"mode"),0);gl.uniform3fv(gl.getUniformLocation(program,"base"),[.12,.1,.08]);gl.drawArrays(gl.LINES,0,wireCount);}
      if(showContours){bind(contourBuffer);gl.uniform1f(gl.getUniformLocation(program,"mode"),0);gl.uniform3fv(gl.getUniformLocation(program,"base"),[.15,.08,.03]);gl.drawArrays(gl.LINES,0,contourCount);}
    }
    let drag=null;canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};if(e.shiftKey){panX+=dx/canvas.clientWidth*2;panY-=dy/canvas.clientHeight*2;}else{angle+=dx*.01;tilt=Math.max(-1.5,Math.min(1.5,tilt+dy*.01));}draw();});canvas.addEventListener("pointerup",()=>drag=null);canvas.addEventListener("wheel",e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*(e.deltaY>0?.9:1.1)));draw();},{passive:false});
    return {webgl:!!(gl&&program),update(m,s){map=m;settings=s;mesh();},draw,view(v){if(v==="top"){angle=0;tilt=0;}else if(v==="front"){angle=0;tilt=1.5;}else if(v==="side"){angle=Math.PI/2;tilt=1.5;}else{angle=-.65;tilt=.75;}draw();},material(v){material=v;draw();},light(v){light=+v;draw();},grid(v){showGrid=!!v;draw();},contours(v){showContours=!!v;draw();},slice(v){slice=Math.max(0,Math.min(1,+v));draw();}};
  }
  root.ReliefPreview={create};
})(typeof self!=="undefined"?self:globalThis);
