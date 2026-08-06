import { requestAI } from '../services/ai.js';

export async function runTool(type, btn) {
  const configs = {
    sum:   {inId:'sumIn',   outId:'sumOut'},
    trans: {inId:'transIn', outId:'transOut'},
    fix:   {inId:'fixIn',   outId:'fixOut'},
  };
  const cfg = configs[type];
  if (!cfg) return;
  const inp = document.getElementById(cfg.inId).value.trim();
  const out = document.getElementById(cfg.outId);
  if (!inp) { out.textContent='Мәтін енгізіңіз'; out.classList.add('show'); return; }
  const original = btn?.innerHTML;
  if (btn) btn.disabled = true;
  out.className='tc-result show'; out.innerHTML='<span class="tloading">Өңделуде...</span>';
  try {
    const payload = { input: inp };
    if (type === 'trans') payload.targetLanguage = document.getElementById('transLang').value;
    const response = await requestAI(type, payload);
    out.textContent = response.text || 'Жауап алынбады';
  } catch (error) {
    out.textContent = error.message || 'Қате орын алды.';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}
