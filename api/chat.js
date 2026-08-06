import { createClient } from '@supabase/supabase-js';

const MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INPUT_CHARS = 12_000;
const MAX_CHAT_CHARS = 30_000;

const MODE_PROMPTS = Object.freeze({
  general:
    'Сен Smart Helper атты оқу көмекшісісің. Қазақ немесе орыс тілінде, пайдаланушы қай тілде сұраса, сол тілде жауап бер. Жауабың түсінікті, дәл, пайдалы және ынталандырушы болсын. Білмесең, ойдан шығармай ашық айт.',
  math:
    'Сен математика мұғалімісісің. Есепті қадамдап түсіндір, формулаларды анық жаз және оқушыны шешімге бағытта. Қате шарт немесе белгісіздік болса, оны көрсет.',
  history:
    'Сен Қазақстан және әлем тарихының мұғалімісісің. Даталар, тұлғалар мен оқиғаларды дәл жеткіз. Даулы немесе белгісіз деректерді факт ретінде көрсетпе.',
  science:
    'Сен жаратылыстану ғылымдарының мұғалімісісің. Күрделі ұғымдарды қарапайым, бірақ ғылыми дәл тілмен түсіндір және қажет болса қысқа мысал келтір.'
});

const JSON_SCHEMAS = Object.freeze({
  planner: {
    name: 'study_plan',
    schema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'integer' },
              title: { type: 'string' },
              tasks: { type: 'string' },
              subject: { type: 'string', enum: ['math', 'sci', 'hist', 'gen'] }
            },
            required: ['day', 'title', 'tasks', 'subject'],
            additionalProperties: false
          }
        }
      },
      required: ['days'],
      additionalProperties: false
    }
  },
  flashcards: {
    name: 'flashcards',
    schema: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          minItems: 6,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              q: { type: 'string' },
              a: { type: 'string' }
            },
            required: ['q', 'a'],
            additionalProperties: false
          }
        }
      },
      required: ['cards'],
      additionalProperties: false
    }
  },
  quiz: {
    name: 'quiz',
    schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              q: { type: 'string' },
              opts: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'string' }
              },
              correct: { type: 'integer', minimum: 0, maximum: 3 }
            },
            required: ['q', 'opts', 'correct'],
            additionalProperties: false
          }
        }
      },
      required: ['questions'],
      additionalProperties: false
    }
  }
});

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function asText(value, max = MAX_INPUT_CHARS) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asBoundedInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

let supabaseAdmin;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error('Supabase server environment is not configured');

  supabaseAdmin = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
  return supabaseAdmin;
}

async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error) throw error;
  return data.user;
}

async function consumeQuota(uid) {
  const minuteLimit = asBoundedInt(process.env.AI_MINUTE_LIMIT, 1, 100, 10);
  const dailyLimit = asBoundedInt(process.env.AI_DAILY_LIMIT, 1, 10_000, 100);
  const { data, error } = await getSupabaseAdmin().rpc('consume_ai_quota', {
    p_user_id: uid,
    p_minute_limit: minuteLimit,
    p_daily_limit: dailyLimit
  });
  if (error) throw error;

  const usage = Array.isArray(data) ? data[0] : data;
  if (!usage || typeof usage.allowed !== 'boolean') {
    throw new Error('Invalid quota response');
  }

  return {
    allowed: usage.allowed,
    minuteLimit,
    dailyLimit,
    minuteRemaining: Number(usage.minute_remaining || 0),
    dailyRemaining: Number(usage.daily_remaining || 0)
  };
}

function buildChatRequest(body) {
  const mode = Object.hasOwn(MODE_PROMPTS, body.mode) ? body.mode : 'general';
  const source = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const messages = [];
  let totalChars = 0;

  for (const message of source) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = asText(message?.content, 5_000);
    if (!content) continue;
    totalChars += content.length;
    if (totalChars > MAX_CHAT_CHARS) break;
    messages.push({ role, content });
  }

  if (!messages.length || messages.at(-1)?.role !== 'user') {
    throw new Error('EMPTY_MESSAGE');
  }

  return {
    messages: [{ role: 'system', content: MODE_PROMPTS[mode] }, ...messages],
    max_tokens: 1_500
  };
}

function buildTextToolRequest(task, body) {
  const input = asText(body.input);
  if (!input) throw new Error('EMPTY_INPUT');

  const prompts = {
    sum: `Мәтінді негізгі ойды сақтап, 3-5 сөйлемге дейін қысқарт. Тек дайын қысқаша мәтінді қайтар:\n\n${input}`,
    trans: `Мәтінді ${asText(body.targetLanguage, 40) || 'қазақ тіліне'} аудар. Мағынасын, атауларын және пішімін сақта. Тек аударманы қайтар:\n\n${input}`,
    fix: `Мәтіндегі емле, тыныс белгілері және грамматикалық қателерді түзет. Мағынасын өзгертпе. Тек түзетілген нұсқаны қайтар:\n\n${input}`,
    idea: `Осы тақырып немесе мақсат бойынша іске жарамды 5 идея ұсын. Әр идеяны қысқа түсіндір:\n\n${input}`
  };

  return {
    messages: [
      {
        role: 'system',
        content: 'Сен қазақ және орыс тілдерінде дәл жұмыс істейтін Smart Helper оқу көмекшісісің.'
      },
      { role: 'user', content: prompts[task] }
    ],
    max_tokens: 900
  };
}

function structuredFormat(name) {
  return {
    type: 'json_schema',
    json_schema: {
      name: JSON_SCHEMAS[name].name,
      strict: true,
      schema: structuredClone(JSON_SCHEMAS[name].schema)
    }
  };
}

function buildStructuredRequest(task, body) {
  const topic = asText(body.topic, 2_000);
  if (!topic) throw new Error('EMPTY_INPUT');

  if (task === 'planner') {
    const goal = asText(body.goal, 2_000) || 'жалпы оқу';
    const days = asBoundedInt(body.days, 1, 30, 7);
    const hours = asBoundedInt(body.hours, 1, 12, 2);
    const format = structuredFormat('planner');
    format.json_schema.schema.properties.days.minItems = days;
    format.json_schema.schema.properties.days.maxItems = days;
    return {
      messages: [
        { role: 'system', content: 'Сен оқушыға шынайы орындалатын, нақты оқу жоспарын жасайтын педагогсің.' },
        { role: 'user', content: `${days} күндік оқу жоспарын жаса. Тақырып: ${topic}. Мақсат: ${goal}. Күніне: ${hours} сағат.` }
      ],
      max_tokens: 1_800,
      response_format: format
    };
  }

  if (task === 'flashcards') {
    return {
      messages: [
        { role: 'system', content: 'Сен есте сақтауға ыңғайлы, қысқа және нақты оқу карточкаларын жасайтын мұғалімсің.' },
        { role: 'user', content: `«${topic}» тақырыбы бойынша дәл 6 сұрақ-жауап карточкасын жаса.` }
      ],
      max_tokens: 1_000,
      response_format: structuredFormat('flashcards')
    };
  }

  const count = asBoundedInt(body.count, 3, 15, 5);
  const format = structuredFormat('quiz');
  format.json_schema.schema.properties.questions.minItems = count;
  format.json_schema.schema.properties.questions.maxItems = count;
  return {
    messages: [
      { role: 'system', content: 'Сен бір ғана дұрыс жауабы бар, анық және фактілік оқу тесттерін жасайтын мұғалімсің.' },
      { role: 'user', content: `«${topic}» тақырыбы бойынша дәл ${count} тест сұрағын жаса. Әр сұрақта 4 жауап нұсқасы болсын.` }
    ],
    max_tokens: 2_000,
    response_format: format
  };
}

function buildModelRequest(body) {
  const task = typeof body.task === 'string' ? body.task : 'chat';
  if (task === 'chat') return buildChatRequest(body);
  if (['sum', 'trans', 'fix', 'idea'].includes(task)) return buildTextToolRequest(task, body);
  if (['planner', 'flashcards', 'quiz'].includes(task)) return buildStructuredRequest(task, body);
  throw new Error('UNKNOWN_TASK');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Тек POST сұрауы қолдау табады' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(res, 413, { error: 'Сұрау тым үлкен' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return json(res, 503, { error: 'AI сервисі әлі бапталмаған' });
  }

  let user;
  try {
    user = await authenticate(req);
  } catch (error) {
    console.error('Supabase authentication failed:', error?.code || error?.message);
    return json(res, 401, { error: 'Қайта кіріп көріңіз' });
  }

  if (!user?.id) {
    return json(res, 401, { error: 'AI қолдану үшін жүйеге кіру қажет' });
  }

  let quota;
  try {
    quota = await consumeQuota(user.id);
  } catch (error) {
    console.error('Rate limit storage failed:', error?.code || error?.message);
    return json(res, 503, { error: 'Сұрау лимитін тексеру мүмкін болмады' });
  }

  if (!quota.allowed) {
    return json(res, 429, {
      error: 'Сұрау лимиті аяқталды. Біраздан кейін қайталап көріңіз.',
      limits: { minute: quota.minuteLimit, day: quota.dailyLimit }
    });
  }

  let modelRequest;
  try {
    modelRequest = buildModelRequest(req.body || {});
  } catch (error) {
    const messages = {
      EMPTY_MESSAGE: 'Хабарлама енгізіңіз',
      EMPTY_INPUT: 'Мәтін немесе тақырып енгізіңіз',
      UNKNOWN_TASK: 'Белгісіз AI құралы'
    };
    return json(res, 400, { error: messages[error.message] || 'Сұрау дұрыс емес' });
  }

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_SITE_URL || 'https://smart-helper.vercel.app',
        'X-OpenRouter-Title': 'Smart Helper'
      },
      body: JSON.stringify({
        model: MODEL,
        ...modelRequest,
        user: user.id,
        temperature: 0.45,
        stream: false
      })
    });

    const data = await upstream.json();
    if (!upstream.ok || data.error) {
      console.error('OpenRouter request failed:', upstream.status, data.error?.code || data.error?.message);
      return json(res, 502, { error: 'AI сервисі уақытша қолжетімсіз' });
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return json(res, 502, { error: 'AI жауабы бос болды' });
    }

    const remaining = {
      minute: quota.minuteRemaining,
      day: quota.dailyRemaining
    };

    if (modelRequest.response_format) {
      try {
        return json(res, 200, { data: JSON.parse(content), remaining });
      } catch {
        console.error('Structured AI response was not valid JSON');
        return json(res, 502, { error: 'AI құрылымды жауап қайтара алмады' });
      }
    }

    return json(res, 200, { text: content.trim(), remaining });
  } catch (error) {
    console.error('AI proxy failed:', error?.name || error?.message);
    return json(res, 502, { error: 'AI сервисіне қосылу мүмкін болмады' });
  }
}
