import { requestAI } from '../services/ai.js';
import { addStat, addXP } from './progress.js';
import { fillMaterialSelect, readSelectedMaterial, saveStudyMaterial } from './library.js';

let quizQuestions=[], quizCurrent=0, quizScore=0, quizTopic='';

function setStatus(text, state = '') {
  const status=document.getElementById('quizGenStatus');
  if (!status) return;
  status.textContent=text;
  status.dataset.state=state;
}

export function initQuiz() {
  fillMaterialSelect('quizSavedSelect', 'quiz').catch((error) => {
    console.warn('Quiz library load failed', error?.code || error?.message);
  });
}

async function generateQuiz(topic, count) {
  if(!topic) return false;
  const btn=document.getElementById('quizGenBtn');
  btn.disabled=true; btn.textContent='Жасалуда...';
  setStatus('1/3 · Сұрау AI-ға жіберілді', 'loading');
  try {
    setStatus('2/3 · AI сұрақтар мен түсіндірмелерді құруда', 'loading');
    const response=await requestAI('quiz',{topic,count:Number(count)});
    const parsed=response.data;
    if(!Array.isArray(parsed?.questions) || !parsed.questions.length) throw new Error('Тест алынбады');
    quizQuestions=parsed.questions; quizCurrent=0; quizScore=0; quizTopic=topic;
    openQuiz();
    setStatus('3/3 · Supabase-ке сақталуда', 'loading');
    try {
      await saveStudyMaterial('quiz', topic, { topic, questions: quizQuestions });
      await fillMaterialSelect('quizSavedSelect', 'quiz');
      setStatus('Дайын және сақталды', 'success');
    } catch (saveError) {
      console.warn('Quiz save failed', saveError?.code || saveError?.message);
      setStatus('Дайын, бірақ Supabase-ке сақталмады', 'warning');
    }
    return true;
  } catch (error) {
    setStatus(error.message||'Қате орын алды', 'error');
    return false;
  } finally {
    btn.disabled=false;
    btn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Тест жасау`;
  }
}

export async function genQuiz() {
  const topic=document.getElementById('quizTopic').value.trim();
  const count=document.getElementById('quizCount').value;
  return generateQuiz(topic, count);
}

export async function createQuizFromText(text) {
  const topic=String(text||'').trim().slice(0, 7000);
  document.getElementById('quizTopic').value=topic;
  return generateQuiz(topic, 5);
}

function openQuiz() {
  document.getElementById('quizSetup').style.display='none';
  document.getElementById('quizResult').style.display='none';
  document.getElementById('quizActive').style.display='block';
  showQuizQ();
}

function showQuizQ() {
  if(quizCurrent>=quizQuestions.length){showQuizResult();return;}
  const q=quizQuestions[quizCurrent],total=quizQuestions.length;
  document.getElementById('quizNum').textContent=`Сұрақ ${quizCurrent+1} / ${total}`;
  document.getElementById('quizQ').textContent=q.q;
  document.getElementById('quizProgressFill').style.width=((quizCurrent/total)*100)+'%';
  const explanation=document.getElementById('quizExplanation');
  explanation.hidden=true; explanation.textContent=''; explanation.dataset.result='';
  document.getElementById('quizNextBtn').hidden=true;
  const opts=document.getElementById('quizOpts'); opts.innerHTML='';
  ['А','Б','В','Г'].forEach((label,index)=>{
    const btn=document.createElement('button'); btn.className='quiz-opt';
    btn.textContent=`${label}. ${q.opts[index]}`;
    btn.addEventListener('click',()=>answerQuiz(index));
    opts.appendChild(btn);
  });
}

function answerQuiz(index) {
  const q=quizQuestions[quizCurrent],btns=document.querySelectorAll('.quiz-opt');
  btns.forEach((button)=>{ button.classList.add('disabled'); button.disabled=true; });
  btns[q.correct]?.classList.add('correct');
  const isCorrect=index===q.correct;
  if(isCorrect){quizScore++;addXP(15);}else{btns[index]?.classList.add('wrong');}
  document.getElementById('quizProgressFill').style.width=((quizCurrent+1)/quizQuestions.length*100)+'%';
  const explanation=document.getElementById('quizExplanation');
  explanation.hidden=false;
  explanation.dataset.result=isCorrect?'correct':'wrong';
  explanation.textContent=isCorrect
    ? `Дұрыс! ${q.explanation||''}`.trim()
    : `Неге қате: ${q.explanation||`Дұрыс жауап — ${q.opts[q.correct]}.`}`;
  document.getElementById('quizNextBtn').hidden=false;
}

export function nextQuizQuestion() {
  quizCurrent++;
  showQuizQ();
}

function showQuizResult() {
  document.getElementById('quizActive').style.display='none';
  document.getElementById('quizResult').style.display='block';
  const pct=Math.round(quizScore/quizQuestions.length*100);
  document.getElementById('quizScoreN').textContent=`${quizScore}/${quizQuestions.length}`;
  document.getElementById('quizScoreMsg').textContent=['Жалғастыр!','Жаман емес!','Жақсы!','Өте жақсы!','Керемет!'][Math.min(4,Math.floor(pct/20))];
  addStat('quiz',1); addXP(quizScore*5);
}

export function loadSavedQuiz() {
  const saved=readSelectedMaterial('quizSavedSelect');
  if (!Array.isArray(saved?.questions) || !saved.questions.length) return;
  quizQuestions=saved.questions; quizCurrent=0; quizScore=0; quizTopic=saved.topic||'';
  openQuiz();
  setStatus('Сақталған тест ашылды', 'success');
}

export function resetQuiz() {
  document.getElementById('quizResult').style.display='none';
  document.getElementById('quizActive').style.display='none';
  document.getElementById('quizSetup').style.display='block';
  if (quizTopic) document.getElementById('quizTopic').value=quizTopic;
}
