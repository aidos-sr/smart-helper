import { requestAI } from '../services/ai.js';
import { addStat, addXP } from './progress.js';
import { fillMaterialSelect, readSelectedMaterial, saveStudyMaterial } from './library.js';

function setStatus(text, state = '') {
  const status=document.getElementById('planStatus');
  if (!status) return;
  status.textContent=text;
  status.dataset.state=state;
}

export function initPlanner() {
  fillMaterialSelect('planSavedSelect', 'planner').catch((error) => {
    console.warn('Planner library load failed', error?.code || error?.message);
  });
}

export async function runPlanner() {
  const topic=document.getElementById('planTopic').value.trim();
  const goal=document.getElementById('planGoal').value.trim();
  const days=document.getElementById('planDays').value;
  const hours=document.getElementById('planHours').value;
  if (!topic) { setStatus('Тақырып жазыңыз', 'error'); return; }
  const btn=document.getElementById('planBtn'); btn.disabled=true; btn.textContent='Жасалуда...';
  const result=document.getElementById('planResult');
  result.innerHTML='<div class="plan-empty"><span class="tloading" style="display:inline-flex">AI жоспар құруда...</span></div>';
  setStatus('1/3 · Сұрау AI-ға жіберілді', 'loading');
  try {
    setStatus('2/3 · AI күндер мен тапсырмаларды құруда', 'loading');
    const response=await requestAI('planner',{topic,goal,days:Number(days),hours:Number(hours)});
    const plan=response.data;
    if (!Array.isArray(plan?.days) || !plan.days.length) throw new Error('Жоспар алынбады');
    renderPlan(plan.days, result);
    addStat('plan',1); addXP(20);
    setStatus('3/3 · Supabase-ке сақталуда', 'loading');
    try {
      await saveStudyMaterial('planner', topic, { topic, goal, days: plan.days });
      await fillMaterialSelect('planSavedSelect', 'planner');
      setStatus('Дайын және сақталды', 'success');
    } catch (saveError) {
      console.warn('Planner save failed', saveError?.code || saveError?.message);
      setStatus('Дайын, бірақ Supabase-ке сақталмады', 'warning');
    }
  } catch (error) {
    result.textContent=error.message||'Қате орын алды.';
    result.style.color='var(--ac4)'; result.style.padding='16px';
    setStatus(error.message||'Қате орын алды', 'error');
  } finally {
    btn.disabled=false;
    btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Жоспар жасау`;
  }
}

export function loadSavedPlan() {
  const saved=readSelectedMaterial('planSavedSelect');
  if (!Array.isArray(saved?.days) || !saved.days.length) return;
  document.getElementById('planTopic').value=saved.topic||'';
  document.getElementById('planGoal').value=saved.goal||'';
  renderPlan(saved.days, document.getElementById('planResult'));
  setStatus('Сақталған жоспар ашылды', 'success');
}

function renderPlan(days, result) {
  const tags={math:'tag-math',sci:'tag-sci',hist:'tag-hist',gen:'tag-gen'};
  const labels={math:'Математика',sci:'Ғылым',hist:'Тарих',gen:'Жалпы'};
  result.replaceChildren(); result.style.color=''; result.style.padding='';
  days.forEach((day)=>{
    const item=document.createElement('div'); item.className='plan-item';
    const dayBox=document.createElement('div'); dayBox.className='plan-day';
    const dayNumber=document.createElement('div'); dayNumber.className='plan-day-n'; dayNumber.textContent=String(day.day);
    const dayLabel=document.createElement('div'); dayLabel.className='plan-day-l'; dayLabel.textContent='КҮН';
    dayBox.append(dayNumber,dayLabel);
    const content=document.createElement('div'); content.className='plan-content';
    const title=document.createElement('h4'); title.textContent=String(day.title||'');
    const tasks=document.createElement('p'); tasks.textContent=String(day.tasks||'');
    const tag=document.createElement('span');
    const subject=Object.hasOwn(tags,day.subject)?day.subject:'gen';
    tag.className=`plan-tag ${tags[subject]}`; tag.textContent=labels[subject];
    content.append(title,tasks,tag); item.append(dayBox,content); result.appendChild(item);
  });
}
