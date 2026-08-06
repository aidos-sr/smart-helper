import { requestAI } from '../services/ai.js';
import { addStat, addXP } from './progress.js';

let quizQuestions=[], quizCurrent=0, quizScore=0;
export async function genQuiz() {
  const topic=document.getElementById('quizTopic').value.trim(),count=document.getElementById('quizCount').value;
  if(!topic) return;
  const btn=document.getElementById('quizGenBtn'); btn.disabled=true; btn.textContent='Жасалуда...';
  try {
    const response=await requestAI('quiz',{topic,count:Number(count)});
    const parsed=response.data;
    if(parsed.questions?.length){quizQuestions=parsed.questions;quizCurrent=0;quizScore=0;document.getElementById('quizSetup').style.display='none';document.getElementById('quizActive').style.display='block';showQuizQ();}
  } catch (error) { alert(error.message||'Қате орын алды'); }
  btn.disabled=false; btn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Тест жасау`;
}
function showQuizQ() {
  if(quizCurrent>=quizQuestions.length){showQuizResult();return;}
  const q=quizQuestions[quizCurrent],total=quizQuestions.length;
  document.getElementById('quizNum').textContent=`Сұрақ ${quizCurrent+1} / ${total}`;
  document.getElementById('quizQ').textContent=q.q;
  document.getElementById('quizProgressFill').style.width=((quizCurrent/total)*100)+'%';
  const opts=document.getElementById('quizOpts'); opts.innerHTML='';
  ['А','Б','В','Г'].forEach((l,i)=>{
    const btn=document.createElement('button'); btn.className='quiz-opt';
    btn.textContent=`${l}. ${q.opts[i]}`; btn.onclick=()=>answerQuiz(i); opts.appendChild(btn);
  });
}
function answerQuiz(idx) {
  const q=quizQuestions[quizCurrent],btns=document.querySelectorAll('.quiz-opt');
  btns.forEach(b=>b.classList.add('disabled')); btns[q.correct].classList.add('correct');
  if(idx===q.correct){quizScore++;addXP(15);}else{btns[idx].classList.add('wrong');}
  setTimeout(()=>{quizCurrent++;showQuizQ();},1200);
}
function showQuizResult() {
  document.getElementById('quizActive').style.display='none';
  document.getElementById('quizResult').style.display='block';
  const pct=Math.round(quizScore/quizQuestions.length*100);
  document.getElementById('quizScoreN').textContent=`${quizScore}/${quizQuestions.length}`;
  document.getElementById('quizScoreMsg').textContent=['Жалғастыр!','Жаман емес!','Жақсы!','Өте жақсы!','Керемет!'][Math.min(4,Math.floor(pct/20))];
  addStat('quiz',1);
  addXP(quizScore*5);
}
export function resetQuiz() { document.getElementById('quizResult').style.display='none'; document.getElementById('quizSetup').style.display='block'; }
