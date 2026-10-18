// A 40px capsule flows monotonically into a 72px circular hub.
// Tangent shoulders avoid pinched notches above and below the avatar.
export function dockOutline(width,center=width/2){
  const c=center,rise=Math.sqrt(36*36-18*18),tangentY=40-rise+11*18/rise;
  return `M20 20 H${c-54} C${c-40} 20 ${c-29} ${tangentY} ${c-18} ${40-rise}
    A36 36 0 0 1 ${c+18} ${40-rise} C${c+29} ${tangentY} ${c+40} 20 ${c+54} 20
    H${width-20} A20 20 0 0 1 ${width} 40 A20 20 0 0 1 ${width-20} 60
    H${c+54} C${c+40} 60 ${c+29} ${80-tangentY} ${c+18} ${40+rise}
    A36 36 0 0 1 ${c-18} ${40+rise} C${c-29} ${80-tangentY} ${c-40} 60 ${c-54} 60
    H20 A20 20 0 0 1 0 40 A20 20 0 0 1 20 20 Z`;
}
