import { requestAI } from '../services/ai.js';
import { addStat, addXP } from './progress.js';
import { shuffleArr } from '../utils/text.js';

const FC_BANK = {
  math:[
    {q:'Пифагор теоремасы?',a:'a² + b² = c²'},
    {q:'sin(30°) = ?',a:'0.5 = 1/2'},
    {q:'cos(60°) = ?',a:'0.5 = 1/2'},
    {q:'π ≈ ?',a:'3.14159...'},
    {q:'Квадрат теңдеудің дискриминанты?',a:'D = b² − 4ac'},
    {q:'Тікбұрышты үшбұрыштың ауданы?',a:'S = (a × h) / 2'},
  ],
  history:[
    {q:'Қазақ хандығы қашан құрылды?',a:'1465 жылы, Керей мен Жәнібек хандардың тұсында'},
    {q:'Қазақстан тәуелсіздік алған жыл?',a:'1991 жыл, 16 желтоқсан'},
    {q:'Ұлы Жібек жолы не болды?',a:'Азия мен Еуропаны байланыстырған сауда жолы'},
    {q:'Алаш қозғалысы қашан болды?',a:'1917-1920 жж.'},
  ],
  science:[
    {q:'Фотосинтез дегеніміз не?',a:'Өсімдіктердің күн энергиясымен глюкоза синтездеуі'},
    {q:'Ньютонның 1-ші заңы?',a:'Инерция заңы: сыртқы күш болмаса дене күйін сақтайды'},
    {q:'Судың химиялық формуласы?',a:'H₂O'},
    {q:'Жарықтың жылдамдығы?',a:'≈ 300,000 км/с'},
    {q:'Атомның ядросы немен тұрады?',a:'Протондар мен нейтрондардан'},
  ],
  kazakh:[
    {q:'Қазақ алфавитіндегі әріп саны?',a:'42 әріп (латынша: 32)'},
    {q:'Абайдың «Қара сөздері» неше?',a:'45 қара сөз'},
    {q:'"Жер" сөзінің орысша аудармасы?',a:'Земля, почва'},
    {q:'"Мен оқушымын" — орысша?',a:'Я ученик / Я студент'},
  ],
};
let fcCards=[...FC_BANK.math], fcIdx=0, fcSubj='math', fcCorrect=0, fcTotal=0;
export function initFlashcards() { loadFCSubj(fcSubj); }
export function setFCSubj(btn) { document.querySelectorAll('.fc-subj').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); fcSubj=btn.dataset.subj; loadFCSubj(fcSubj); }
function loadFCSubj(subj) { fcCards=[...(FC_BANK[subj]||FC_BANK.math)]; shuffleArr(fcCards); fcIdx=0; fcCorrect=0; fcTotal=0; showCard(); }
function showCard() {
  if (!fcCards.length) return;
  const card=fcCards[fcIdx%fcCards.length];
  document.getElementById('fcQuestion').textContent=card.q;
  document.getElementById('fcAnswer').textContent=card.a;
  document.getElementById('cardInner').classList.remove('flipped');
  document.getElementById('fcProgress').textContent=`${fcIdx+1} / ${fcCards.length}`;
}
export function flipCard() { document.getElementById('cardInner').classList.toggle('flipped'); }
export function fcResult(type) { if(type==='good') fcCorrect++; fcTotal++; addStat('card',1); addXP(5); nextCard(); }
export function nextCard() { fcIdx=(fcIdx+1)%fcCards.length; showCard(); }
export async function genFlashcards() {
  const topic=document.getElementById('fcGenTopic').value.trim(); if(!topic) return;
  const btn=document.getElementById('fcGenBtn'); btn.disabled=true; btn.textContent='Жасалуда...';
  try {
    const response=await requestAI('flashcards',{topic});
    const parsed=response.data;
    if(parsed.cards?.length){fcCards=parsed.cards;fcIdx=0;document.getElementById('fcProgress').textContent=`1/${fcCards.length}`;showCard();document.getElementById('fcGenTopic').value='';}
  } catch (error) { alert(error.message||'Қате орын алды'); }
  btn.disabled=false; btn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> AI карточкалар жасау`;
}
