(function (root) {
  "use strict";
  const C = root.OutlinesCore || (typeof require === "function" ? require("./outlines-core.js") : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const id = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `relief-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function layer(name, height, mask, color = "#d9a654") {
    return { id: id(), name, visible: true, locked: false, height, smoothing: 0, edge: "hard", color, mask: new Uint8Array(mask), contours: [] };
  }
  function project(width, height, settings = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || Math.max(width,height) > 320) throw Error("Ungültige oder zu große Reliefauflösung.");
    return { schema: 1, id: id(), name: "Neues Relief", width, height, settings: { widthMm: 160, heightMm: 160, thicknessMm: 20, reliefMm: 8, toolMinMm: 3, toolMaxMm: 12, safetyMm: 1, fit: "fit", overlap: "highest", style: "steps", ...settings }, layers: [], edits: new Float32Array(width * height), cuts: [] };
  }
  function validate(p) {
    if (!p || p.schema !== 1 || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 2 || p.height < 2 || Math.max(p.width,p.height) > 320 || !Array.isArray(p.layers) || p.layers.length > 64) throw Error("Ungültiges Reliefprojekt.");
    const s = p.settings;
    for (const key of ["widthMm", "heightMm", "thicknessMm", "reliefMm"]) if (!Number.isFinite(+s[key]) || +s[key] <= 0 || +s[key] > 3000) throw Error(`Ungültiger Wert: ${key}`);
    if (+s.reliefMm > +s.thicknessMm) throw Error("Die Reliefhöhe darf die Holzdicke nicht überschreiten.");
    for (const l of p.layers) if (!l || !l.id || l.mask.length !== p.width * p.height || !Number.isFinite(+l.height)) throw Error("Ungültige Reliefebene.");
    return p;
  }
  function maskOperation(target, other, operation) {
    if (target.length !== other.length) throw Error("Maskenauflösung stimmt nicht überein.");
    const out = new Uint8Array(target.length);
    for (let i = 0; i < out.length; i++) out[i] = operation === "union" ? +(!!target[i] || !!other[i]) : operation === "subtract" ? +(!!target[i] && !other[i]) : operation === "intersect" ? +(!!target[i] && !!other[i]) : operation === "copy" ? +!!other[i] : +!target[i];
    return out;
  }
  function compose(p) {
    validate(p);
    const n = p.width * p.height, heights = new Float32Array(n), owners = new Int16Array(n).fill(-1), overlaps = new Uint8Array(n);
    const max = +p.settings.reliefMm, mode = p.settings.overlap;
    p.layers.forEach((l, index) => {
      if (!l.visible) return;
      const z = clamp(+l.height, 0, max);
      const radius=clamp(Math.round(+l.smoothing||0),0,8),softened=radius||l.edge!=="hard"?smooth(Float32Array.from(l.mask),p.width,p.height,Math.max(1,radius||1)):l.mask;
      for (let i = 0; i < n; i++) if (softened[i]) {
        const weight=l.edge==="rounded"?softened[i]*softened[i]*(3-2*softened[i]):softened[i],target=z*weight;
        if (owners[i] >= 0) {
          overlaps[i] = 1;
          if (mode === "cut") { heights[i] = 0; owners[i] = -1; continue; }
        }
        if (mode === "highest" ? target >= heights[i] : true) { heights[i] = target; owners[i] = index; }
      }
    });
    const ratio = (p.width / p.height) / (p.settings.widthMm / p.settings.heightMm);
    if (p.settings.fit !== "stretch" && Math.abs(ratio - 1) > .001) {
      let scaleX = 1, scaleY = 1;
      if (p.settings.fit === "fit") { if (ratio < 1) scaleX = ratio; else scaleY = 1 / ratio; }
      else if (p.settings.fit === "crop") { if (ratio < 1) scaleY = 1 / ratio; else scaleX = ratio; }
      const original = new Float32Array(heights), originalOwners = new Int16Array(owners), originalOverlaps = new Uint8Array(overlaps);
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        const sx = Math.round((x - (p.width - 1) / 2) / scaleX + (p.width - 1) / 2), sy = Math.round((y - (p.height - 1) / 2) / scaleY + (p.height - 1) / 2), i = y * p.width + x;
        if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) { heights[i] = 0; owners[i] = -1; overlaps[i] = 0; }
        else { const j = sy * p.width + sx; heights[i] = original[j]; owners[i] = originalOwners[j]; overlaps[i] = originalOverlaps[j]; }
      }
    }
    if (p.settings.style === "flat") for (let i = 0; i < n; i++) heights[i] *= .5;
    if (p.settings.style === "silhouette") for (let i = 0; i < n; i++) heights[i] = heights[i] > 0 ? max : 0;
    if (p.settings.style === "negative") for (let i = 0; i < n; i++) heights[i] = max - heights[i];
    if (p.settings.style === "soft") heights.set(smooth(heights, p.width, p.height, 2));
    if (p.edits) for (let i = 0; i < n; i++) heights[i] = clamp(heights[i] + (p.edits[i] || 0), 0, max);
    return { width: p.width, height: p.height, values: heights, owners, overlaps };
  }
  function smooth(values, width, height, radius = 1) {
    let src = new Float32Array(values);
    for (let pass = 0; pass < radius; pass++) {
      const dst = new Float32Array(src.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < width && yy < height) { sum += src[yy * width + xx]; count++; } }
        dst[y * width + x] = sum / count;
      }
      src = dst;
    }
    return src;
  }
  function sample(map, x, y) {
    const xx = clamp(x, 0, map.width - 1), yy = clamp(y, 0, map.height - 1), x0 = Math.floor(xx), y0 = Math.floor(yy), x1 = Math.min(x0 + 1, map.width - 1), y1 = Math.min(y0 + 1, map.height - 1), u = xx - x0, v = yy - y0;
    return (map.values[y0 * map.width + x0] * (1 - u) + map.values[y0 * map.width + x1] * u) * (1 - v) + (map.values[y1 * map.width + x0] * (1 - u) + map.values[y1 * map.width + x1] * u) * v;
  }
  function section(map, p, a, b, name = "Schnitt") {
    const lengthMm = Math.hypot((b.x - a.x) * p.settings.widthMm / (p.width - 1), (b.y - a.y) * p.settings.heightMm / (p.height - 1));
    const count = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1), points = [];
    for (let i = 0; i < count; i++) { const t = i / (count - 1); points.push({ mm: t * lengthMm, z: sample(map, a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)) }); }
    return { id: id(), name, a, b, lengthMm, points, min: Math.min(...points.map(x => x.z)), max: Math.max(...points.map(x => x.z)) };
  }
  function contours(map, level) {
    const { width: w, height: h, values: v } = map, segments = [];
    const get=(x,y)=>x<0||y<0||x>=w||y>=h?level-1:v[y*w+x];
    const cross = (x, y, edge) => { const corners = [[x,y],[x+1,y],[x+1,y+1],[x,y+1]], [a,b] = [[0,1],[1,2],[2,3],[3,0]][edge], va = get(...corners[a]), vb = get(...corners[b]), t = va === vb ? .5 : clamp((level-va)/(vb-va),0,1); return [clamp(corners[a][0]+t*(corners[b][0]-corners[a][0]),0,w-1),clamp(corners[a][1]+t*(corners[b][1]-corners[a][1]),0,h-1)]; };
    for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
      const vals = [get(x,y),get(x+1,y),get(x+1,y+1),get(x,y+1)], edges = [];
      for (let e = 0; e < 4; e++) if ((vals[e] >= level) !== (vals[(e+1)%4] >= level)) edges.push(e);
      if (edges.length === 2) segments.push([cross(x,y,edges[0]),cross(x,y,edges[1])]);
      else if (edges.length === 4) { const center = vals.reduce((a,b)=>a+b,0)/4; const pairs = (center >= level) === (vals[0] >= level) ? [[0,1],[2,3]] : [[0,3],[1,2]]; for (const [a,b] of pairs) segments.push([cross(x,y,a),cross(x,y,b)]); }
    }
    return segments;
  }
  function paint(p, map, x, y, radius, mode, strength, hardness = .7, target = 0) {
    if (!p.edits) p.edits = new Float32Array(p.width * p.height);
    const r = Math.max(.5, radius), x0 = Math.max(0, Math.floor(x-r)), x1 = Math.min(p.width-1,Math.ceil(x+r)), y0 = Math.max(0,Math.floor(y-r)), y1 = Math.min(p.height-1,Math.ceil(y+r));
    const before = mode === "smooth" ? new Float32Array(map.values) : null;
    for (let yy=y0;yy<=y1;yy++) for(let xx=x0;xx<=x1;xx++) { const d=Math.hypot(xx-x,yy-y)/r; if(d>1)continue; const weight=d<hardness?1:(1-d)/Math.max(.001,1-hardness), i=yy*p.width+xx, z=map.values[i]; let next=z;
      if(mode==="raise")next=z+strength*weight; else if(mode==="lower")next=z-strength*weight; else if(mode==="level")next=z+(target-z)*weight; else if(mode==="smooth") { let sum=0,n=0; for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const sx=clamp(xx+ox,0,p.width-1),sy=clamp(yy+oy,0,p.height-1);sum+=before[sy*p.width+sx];n++;}next=z+(sum/n-z)*weight; }
      const bounded=clamp(next,0,p.settings.reliefMm); p.edits[i]+=bounded-z; map.values[i]=bounded;
    }
  }
  function serialize(p) { validate(p); return JSON.stringify({ ...p, layers:p.layers.map(l=>({...l,mask:Array.from(l.mask)})),edits:Array.from(p.edits||[]) }); }
  function deserialize(json) { const raw=typeof json==="string"?JSON.parse(json):json; const p={...raw,layers:raw.layers.map(l=>({...l,mask:Uint8Array.from(l.mask)})),edits:Float32Array.from(raw.edits||new Array(raw.width*raw.height).fill(0))}; return validate(p); }
  function stl(map,p,detail=140){
    validate(p);const xs=[],ys=[],step=Math.max(1,Math.ceil(Math.max(map.width,map.height)/detail));
    for(let x=0;x<map.width-1;x+=step)xs.push(x);xs.push(map.width-1);
    for(let y=0;y<map.height-1;y+=step)ys.push(y);ys.push(map.height-1);
    const top=(x,y)=>[x*p.settings.widthMm/(map.width-1),y*p.settings.heightMm/(map.height-1),p.settings.thicknessMm-p.settings.reliefMm+map.values[y*map.width+x]],base=(x,y)=>[x*p.settings.widthMm/(map.width-1),y*p.settings.heightMm/(map.height-1),0],tri=[];
    function facet(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1;tri.push(`facet normal ${n.map(q=>q/len).join(" ")}\n outer loop\n${[a,b,c].map(q=>`  vertex ${q.join(" ")}`).join("\n")}\n endloop\nendfacet`);}
    for(let yi=0;yi<ys.length-1;yi++)for(let xi=0;xi<xs.length-1;xi++){const x=xs[xi],xx=xs[xi+1],y=ys[yi],yy=ys[yi+1],a=top(x,y),b=top(xx,y),c=top(xx,yy),d=top(x,yy),e=base(x,y),f=base(xx,y),g=base(xx,yy),h=base(x,yy);facet(a,b,c);facet(a,c,d);facet(e,g,f);facet(e,h,g);}
    for(let i=0;i<xs.length-1;i++){const x=xs[i],xx=xs[i+1],y0=ys[0],y1=ys[ys.length-1];facet(top(x,y0),base(xx,y0),top(xx,y0));facet(top(x,y0),base(x,y0),base(xx,y0));facet(top(xx,y1),base(x,y1),top(x,y1));facet(top(xx,y1),base(xx,y1),base(x,y1));}
    for(let i=0;i<ys.length-1;i++){const y=ys[i],yy=ys[i+1],x0=xs[0],x1=xs[xs.length-1];facet(top(x0,yy),base(x0,y),top(x0,y));facet(top(x0,yy),base(x0,yy),base(x0,y));facet(top(x1,y),base(x1,yy),top(x1,yy));facet(top(x1,y),base(x1,y),base(x1,yy));}
    return`solid relief_mm\n${tri.join("\n")}\nendsolid relief_mm`;
  }
  function suggest(width,height,rgba,method="brightness",count=4,sensitivity=50,subject=null){
    const n=width*height,k=clamp(Math.round(count),2,8),masks=Array.from({length:k},()=>new Uint8Array(n));
    if(rgba.length!==n*4)throw Error("Bilddaten passen nicht zur Reliefauflösung.");
    const eligible=i=>rgba[i*4+3]>=16&&(!subject||subject[i]);
    if(method==="components"){
      const step=Math.max(12,Math.round(100-clamp(sensitivity,0,100)*.88));
      const keys=new Int32Array(n).fill(-1),seen=new Uint8Array(n),groups=[];
      for(let i=0;i<n;i++)if(eligible(i)){
        const offset=i*4,r=Math.floor(rgba[offset]/step),g=Math.floor(rgba[offset+1]/step),b=Math.floor(rgba[offset+2]/step);
        keys[i]=(r<<12)|(g<<6)|b;
      }
      for(let start=0;start<n;start++)if(keys[start]>=0&&!seen[start]){
        const pixels=[start];seen[start]=1;
        for(let at=0;at<pixels.length;at++){
          const i=pixels[at],x=i%width,y=(i/width)|0,key=keys[i];
          for(const next of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])
            if(next>=0&&!seen[next]&&keys[next]===key){seen[next]=1;pixels.push(next);}
        }
        groups.push(pixels);
      }
      groups.sort((a,b)=>b.length-a.length);
      const owners=new Int16Array(n).fill(-1),queue=[];
      groups.slice(0,k).forEach((pixels,j)=>{for(const i of pixels){owners[i]=j;queue.push(i);}});
      for(let at=0;at<queue.length;at++){
        const i=queue[at],x=i%width,y=(i/width)|0;
        for(const next of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])
          if(next>=0&&keys[next]>=0&&owners[next]<0){owners[next]=owners[i];queue.push(next);}
      }
      for(let i=0;i<n;i++)if(owners[i]>=0)masks[owners[i]][i]=1;
      return masks;
    }
    if(method==="edges"){
      const candidate=new Uint8Array(n),gray=new Uint8Array(n);
      for(let i=0;i<n;i++)gray[i]=Math.round(.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2]);
      const edges=method==="edges"?C.sobelEdges(gray,width,height,clamp(60-sensitivity*.4,8,60),clamp(90-sensitivity*.4,20,90)):null;
      for(let i=0;i<n;i++)candidate[i]=eligible(i)&&(!edges||!edges[i])?1:0;
      C.components(candidate,width,height,1).sort((a,b)=>b.size-a.size).slice(0,k).forEach((group,j)=>{for(const pixel of group.pixels)masks[j][pixel]=1;});
      return masks;
    }
    if(method==="color"){
      const eligiblePixels=[];for(let i=0;i<n;i++)if(eligible(i))eligiblePixels.push(i);
      const centers=[];
      if(eligiblePixels.length)centers.push(Array.from(rgba.slice(eligiblePixels[0]*4,eligiblePixels[0]*4+3)));
      while(centers.length<k&&eligiblePixels.length){
        let best=eligiblePixels[0],distance=-1;
        for(const i of eligiblePixels){let nearest=Infinity;for(const center of centers){let d=0;for(let c=0;c<3;c++)d+=(rgba[i*4+c]-center[c])**2;nearest=Math.min(nearest,d);}if(nearest>distance){distance=nearest;best=i;}}
        centers.push(Array.from(rgba.slice(best*4,best*4+3)));
      }
      if(!centers.length)return masks;
      const group=new Uint8Array(n);
      for(let pass=0;pass<6;pass++){
        const sum=Array.from({length:k},()=>[0,0,0,0]);
        for(let i=0;i<n;i++)if(eligible(i)){let best=0,dmin=Infinity;for(let j=0;j<k;j++){let d=0;for(let c=0;c<3;c++)d+=(rgba[i*4+c]-centers[j][c])**2;if(d<dmin){dmin=d;best=j;}}group[i]=best;for(let c=0;c<3;c++)sum[best][c]+=rgba[i*4+c];sum[best][3]++;}
        for(let j=0;j<k;j++)if(sum[j][3])for(let c=0;c<3;c++)centers[j][c]=sum[j][c]/sum[j][3];
      }
      const minimumDistance=70*(1-clamp(sensitivity,0,100)/100);
      const representative=[];
      centers.forEach((center,j)=>{
        let nearest=j,distance=Infinity;
        for(let previous=0;previous<j;previous++){
          const d=Math.hypot(...center.map((v,c)=>v-centers[previous][c]));
          if(d<distance){distance=d;nearest=representative[previous];}
        }
        representative[j]=distance<minimumDistance?nearest:j;
      });
      for(let i=0;i<n;i++)if(eligible(i))masks[representative[group[i]]][i]=1;
    }else{
      let low=255,high=0;
      const luminance=i=>.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2];
      for(let i=0;i<n;i++)if(eligible(i)){const lum=luminance(i);low=Math.min(low,lum);high=Math.max(high,lum);}
      const span=Math.max(1,high-low),contrast=.35+.65*clamp(sensitivity,0,100)/100;
      for(let i=0;i<n;i++)if(eligible(i)){
        const normalized=.5+((luminance(i)-low)/span-.5)*contrast;
        const j=clamp(Math.floor(normalized*k),0,k-1);masks[j][i]=1;
      }
    }
    return masks;
  }
  function distanceField(mask,width,height,sx,sy){
    const dist=new Float32Array(mask.length),diag=Math.hypot(sx,sy);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;dist[i]=!mask[i]||!x||!y||x===width-1||y===height-1?0:Infinity;}
    for(let y=1;y<height;y++)for(let x=1;x<width;x++){const i=y*width+x;if(!dist[i])continue;dist[i]=Math.min(dist[i],dist[i-1]+sx,dist[i-width]+sy,dist[i-width-1]+diag,x+1<width?dist[i-width+1]+diag:Infinity);}
    for(let y=height-2;y>=0;y--)for(let x=width-2;x>=0;x--){const i=y*width+x;if(!dist[i])continue;dist[i]=Math.min(dist[i],dist[i+1]+sx,dist[i+width]+sy,dist[i+width+1]+diag,x>0?dist[i+width-1]+diag:Infinity);}
    return dist;
  }
  function analyze(map,p,toolMm=3,maxToolMm=12){
    const sx=p.settings.widthMm/(p.width-1),sy=p.settings.heightMm/(p.height-1),area=p.settings.widthMm*p.settings.heightMm/(p.width*p.height),v=map.values;
    let min=Infinity,max=0,maxSlope=0,volume=0;
    for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const i=y*p.width+x,z=v[i];min=Math.min(min,z);max=Math.max(max,z);volume+=(p.settings.reliefMm-z)*area;if(x+1<p.width)maxSlope=Math.max(maxSlope,Math.abs(v[i+1]-z)/sx);if(y+1<p.height)maxSlope=Math.max(maxSlope,Math.abs(v[i+p.width]-z)/sy);}
    const mask=new Uint8Array(v.length);for(let i=0;i<v.length;i++)mask[i]=v[i]>=p.settings.reliefMm*.5?1:0;
    const groups=C.components(mask,p.width,p.height,1),distance=distanceField(mask,p.width,p.height,sx,sy),diameter=g=>{let largest=0;for(const i of g.pixels)largest=Math.max(largest,distance[i]);return largest*2;},thin=groups.filter(g=>diameter(g)<toolMm),wide=groups.filter(g=>diameter(g)>=maxToolMm);
    let narrowCorePixels=0;
    for(let y=1;y<p.height-1;y++)for(let x=1;x<p.width-1;x++){const i=y*p.width+x,d=distance[i];if(!mask[i]||!d||d*2>=toolMm)continue;const left=distance[i-1],right=distance[i+1],up=distance[i-p.width],down=distance[i+p.width];if((d>=left&&d>=right&&(d>left||d>right))||(d>=up&&d>=down&&(d>up||d>down)))narrowCorePixels++;}
    const warnings=[];
    if(maxSlope>1.5)warnings.push(`Steilster Höhenwechsel: ${maxSlope.toFixed(1)} mm je mm.`);
    if(thin.length)warnings.push(`${thin.length} erhöhte Bereiche sind schmaler als ${toolMm} mm Werkzeugbreite.`);
    if(narrowCorePixels)warnings.push(`${narrowCorePixels} lokale Engstellen unterschreiten ${toolMm} mm Werkzeugbreite.`);
    if(p.settings.thicknessMm-p.settings.reliefMm+min<2)warnings.push(`Mindeststärke nur ${(p.settings.thicknessMm-p.settings.reliefMm+min).toFixed(1)} mm.`);
    return{min,max,maxSlope,volumeMm3:volume,minRemainingMm:p.settings.thicknessMm-p.settings.reliefMm+min,thinRegions:thin.length,narrowCorePixels,wideRegions:wide.length,warnings};
  }
  function sheets(p,map,step=1,includeLayers=true){
    validate(p);if(!Number.isFinite(step)||step<=0)throw Error("Ungültiger Höhenlinienabstand.");
    const interval=Math.max(step,p.settings.reliefMm/200),levels=[],overview=[];for(let z=interval;z<=p.settings.reliefMm+1e-6;z+=interval){levels.push(+z.toFixed(3));overview.push(...contours(map,z));}
    const output=[{title:"Gesamtvorlage",subtitle:`${p.settings.widthMm} x ${p.settings.heightMm} mm; Abstand ${interval.toFixed(2)} mm`,paths:overview,levels}];
    if(includeLayers)for(const l of p.layers){const temporary={...p,settings:{...p.settings,style:"steps"},layers:[{...l,visible:true,height:p.settings.reliefMm}],edits:null},single=compose(temporary);output.push({title:`Ebene: ${l.name}`,subtitle:`Hoehe ${Number(l.height).toFixed(1)} mm`,paths:contours(single,p.settings.reliefMm*.5),levels:[Number(l.height)]});}
    return output;
  }
  function svg(p,map,step=1,scope="all",mirrored=false){
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&apos;"}[c]));
    const all=sheets(p,map,step,true),chosen=scope==="overview"?all.slice(0,1):scope==="layers"?all.slice(1):all;
    const sx=p.settings.widthMm/(p.width-1),sy=p.settings.heightMm/(p.height-1),x=value=>(mirrored?p.settings.widthMm-value*sx:value*sx).toFixed(3),y=value=>(value*sy).toFixed(3);
    const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${p.settings.widthMm}mm" height="${p.settings.heightMm}mm" viewBox="0 0 ${p.settings.widthMm} ${p.settings.heightMm}"><title>${escape(p.name)}</title><desc>ReliefLayers, Masse in Millimetern; Ebenenhoehen manuell festgelegt. Linienabstand ${Math.max(step,p.settings.reliefMm/200).toFixed(2)} mm.</desc>`];
    for(const sheet of chosen){parts.push(`<g fill="none" stroke="#000" stroke-width="0.2" data-sheet="${escape(sheet.title)}" data-height-mm="${escape(sheet.levels.join(","))}">`);for(const line of sheet.paths)parts.push(`<path d="M${x(line[0][0])} ${y(line[0][1])}L${x(line[1][0])} ${y(line[1][1])}"/>`);parts.push("</g>");}
    parts.push("</svg>");return parts.join("");
  }
  const api={clamp,layer,project,validate,maskOperation,compose,smooth,sample,section,contours,paint,serialize,deserialize,stl,suggest,analyze,sheets,svg};
  root.ReliefCore=api; if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof self!=="undefined"?self:globalThis);
