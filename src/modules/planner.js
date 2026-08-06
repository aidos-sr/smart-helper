import { requestAI } from '../services/ai.js';
import { addStat, addXP } from './progress.js';
import { esc } from '../utils/text.js';

export async function runPlanner() {
  const topic=document.getElementById('planTopic').value.trim(),goal=document.getElementById('planGoal').value.trim(),days=document.getElementById('planDays').value,hours=document.getElementById('planHours').value;
  if (!topic) { alert('Тақырып жазыңыз'); return; }
  const btn=document.getElementById('planBtn'); btn.disabled=true; btn.textContent='Жасалуда...';
  const result=document.getElementById('planResult');
  result.innerHTML='<div class="plan-empty"><span class="tloading" style="display:inline-flex">Жасалуда...</span></div>';
  try {
    const response=await requestAI('planner',{topic,goal,days:Number(days),hours:Number(hours)});
    const plan=response.data;
    if (!Array.isArray(plan?.days) || !plan.days.length) throw new Error('Жоспар алынбады');
    renderPlan(plan.days, result);
    addStat('plan',1); addXP(20);
  } catch (error) {
    result.textContent=error.message||'Қате орын алды.';
    result.style.color='var(--ac4)';
    result.style.padding='16px';
  }
  btn.disabled=false; btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Жоспар жасау`;
}

function renderPlan(days, result) {
  const tags={math:'tag-math',sci:'tag-sci',hist:'tag-hist',gen:'tag-gen'};
  const labels={math:'Математика',sci:'Ғылым',hist:'Тарих',gen:'Жалпы'};
  result.replaceChildren();
  result.style.color='';
  result.style.padding='';

  days.forEach(day=>{
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
    content.append(title,tasks,tag);
    item.append(dayBox,content);
    result.appendChild(item);
  });
}
