export function fmtTxt(t) {
  return esc(t)
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/`(.*?)`/g,`<code style="background:var(--sf2);padding:2px 6px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:.8em">$1</code>`)
    .replace(/\n/g,'<br>');
}
export function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function shuffleArr(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
