import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const groqKey = Deno.env.get('GROQ_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if ((!openaiKey && !geminiKey && !groqKey) || !supabaseUrl || !anonKey) return json({ error: 'Backend setup incomplete. Add GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY, plus Supabase environment settings.' }, 503);
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Please sign in to use Smart AI.' }, 401);
  const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401);
  try {
    const body = await req.json();
    // Direct image requests from chat should create/edit an image, not return instructions.
    const chatText = typeof body.message === 'string' ? body.message.trim() : '';
    const asksForImage = /\b(generate|create|draw|make|produce)\b.{0,45}\b(image|picture|illustration|artwork|photo)\b|\b(image|picture|illustration|artwork)\b.{0,35}\b(generate|create|draw|make)\b/i.test(chatText);
    const asksToEdit = /\b(edit|change|modify|remove|replace|retouch|redesign)\b/i.test(chatText) && typeof body.image === 'string' && body.image.startsWith('data:image/');
    if (!body.action && asksToEdit) body.action = 'edit_image';
    else if (!body.action && asksForImage) body.action = 'generate_image';
    // Image generation and editing stay server-side so provider keys never reach the browser.
    if (body.action === 'generate_image' || body.action === 'edit_image') {
      if (!openaiKey) return json({ error: 'Image generation and editing need an OPENAI_API_KEY with image access and available credits. Gemini chat can work separately.' }, 503);
      const prompt = String(body.prompt || body.message || '').trim();
      if (!prompt) return json({ error: 'Describe the image you want to create or edit.' }, 400);
      if (prompt.length > 4000) return json({ error: 'Please keep image descriptions under 4,000 characters.' }, 413);
      let imageResponse: Response;
      if (body.action === 'edit_image') {
        if (typeof body.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(body.image)) {
          return json({ error: 'Choose a PNG, JPEG, or WebP image to edit first.' }, 400);
        }
        if (body.image.length > 11_000_000) return json({ error: 'Image is too large. Choose a smaller image.' }, 413);
        const match = body.image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) return json({ error: 'The selected image format is not supported.' }, 400);
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
        const form = new FormData();
        form.append('model', Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1');
        form.append('prompt', prompt);
        form.append('size', '1024x1024');
        form.append('image', new Blob([bytes], { type: match[1] }), `upload.${ext}`);
        imageResponse = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form
        });
      } else {
        imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1', prompt, size: '1024x1024', quality: 'medium', output_format: 'png' })
        });
      }
      const imageResult = await imageResponse.json();
      if (!imageResponse.ok) return json({ error: imageResult?.error?.message || 'Image generation/editing failed. Check image-model access and API credits.' }, 502);
      const base64 = imageResult?.data?.[0]?.b64_json;
      if (!base64) return json({ error: 'The image provider returned no image. Please try again.' }, 502);
      return json({ image: `data:image/png;base64,${base64}` });
    }
    const message = String(body.message || '').trim();
    if (!message && !body.image) return json({ error: 'Write a message or attach an image.' }, 400);
    if (message.length > 12000) return json({ error: 'Please keep each message under 12,000 characters.' }, 413);
    const content: any[] = [];
    if (message) content.push({ type: 'input_text', text: message });
    if (typeof body.image === 'string' && body.image.startsWith('data:image/')) {
      if (body.image.length > 11_000_000) return json({ error: 'Image is too large. Choose a smaller image.' }, 413);
      content.push({ type: 'input_image', image_url: body.image });
    }
    const history = Array.isArray(body.history) ? body.history.slice(-10).filter((m: any) => ['user','assistant'].includes(m.role) && typeof m.content === 'string').map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) })) : [];
    const input = [...history, { role: 'user', content }];
    let instructions = 'Your name is Smart AI. You are the AI assistant inside the Smart AI app. Smart AI was founded and is owned by Monday Light. If anyone asks who founded, owns, or created Smart AI, answer clearly: Monday Light is the founder and owner of Smart AI. Do not invent extra biographical details about Monday Light; only share personal details the owner has explicitly provided and that are relevant. If asked your name, answer: I am Smart AI. Never claim to be another assistant. Be fast, useful, and accurate: answer the exact question first, use plain language, and normally keep answers concise unless the user asks for detail. For greetings, simple arithmetic, translation, rewriting, creative writing, and stable everyday explanations, answer directly without web search. For current events, recent developments, current prices, laws or policies, specific named entities, important health/financial/safety facts, or whenever the user asks you to verify/search, use the enabled browser_search tool before answering. Prefer primary and official sources, cross-check important claims when practical, explain uncertainty or conflicting information, and include clickable source links for researched claims. Never invent sources, citations, facts, or URLs. Do not add self-introductions, unrelated tips, repeated summaries, or unsolicited offers. If asked for code, provide the code. If asked to create an image, use the image-generation action rather than explaining how. Never claim an action succeeded unless it did. If blocked, state the specific reason briefly.';
    const { data: preferences } = await sb.from('user_preferences').select('memory_enabled,memory_text')
      .eq('user_id', user.id).maybeSingle();
    if (preferences?.memory_enabled && typeof preferences.memory_text === 'string' && preferences.memory_text.trim()) {
      instructions += '\n\nUser-approved memory for personalization (use only when relevant): ' + preferences.memory_text.slice(0, 4000);
    }
    let reply = '';
    // Secondary-provider fallback: if the preferred provider fails, try Groq when configured.
    async function tryGroqFallback(): Promise<string> {
      if (!groqKey) return '';
      const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-20b';
      const messages: any[] = [{ role: 'system', content: instructions }];
      for (const item of history) messages.push({ role: item.role, content: item.content });
      const imageAttached = typeof body.image === 'string' && /^data:image\\/(png|jpeg|jpg|webp);base64,/.test(body.image);
      const userContent: any = imageAttached
        ? [{ type: 'text', text: message || 'Please describe this image and help me understand it.' }, { type: 'image_url', image_url: { url: body.image } }]
        : (message || 'Please help me with the attached image.');
      messages.push({ role: 'user', content: userContent });
      const selectedModel = imageAttached ? (Deno.env.get('GROQ_VISION_MODEL') || 'qwen/qwen3.8-27b') : model;
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, messages, max_tokens: 1000, temperature: 0.4, ...(selectedModel.startsWith('openai/gpt-oss-') && !imageAttached ? { tools: [{ type: 'browser_search' }] } : {}) })
      });
      const result = await response.json();
      if (!response.ok) return '';
      return result?.choices?.[0]?.message?.content?.trim() || '';
    }
    // Prefer an alternate provider when its key is configured, so an exhausted Groq quota does not block chat.
    if (groqKey && !geminiKey && !openaiKey) {
      const messages: any[] = [{ role: 'system', content: instructions }];
      for (const item of history) messages.push({ role: item.role, content: item.content });
      let userContent: any = message || 'Please help me with the attached image.';
      let model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-20b';
      if (typeof body.image === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(body.image)) {
        // Use Groq's multimodal model for image questions; keep the normal model for text-only chat.
        model = Deno.env.get('GROQ_VISION_MODEL') || 'qwen/qwen3.8-27b';
        userContent = [
          { type: 'text', text: message || 'Please describe this image and help me understand it.' },
          { type: 'image_url', image_url: { url: body.image } }
        ];
      }
      messages.push({ role: 'user', content: userContent });
      const ai = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4, ...(model.startsWith('openai/gpt-oss-') && !userContent?.some?.((part: any) => part.type === 'image_url') ? { tools: [{ type: 'browser_search' }] } : {}) })
      });
      let result = await ai.json();
      // If a configured larger model is rate-limited, retry once on the faster/lighter GPT-OSS 20B model.
      if (!ai.ok && ai.status === 429 && model !== 'openai/gpt-oss-20b' && !userContent?.some?.((part: any) => part.type === 'image_url')) {
        const retryModel = 'openai/gpt-oss-20b';
        const retry = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: retryModel, messages, max_tokens: 1200, temperature: 0.4, tools: [{ type: 'browser_search' }] })
        });
        result = await retry.json();
        if (!retry.ok) return json({ error: result?.error?.message || 'Smart AI has reached the provider usage limit. Please wait and try again.' }, 429);
      } else if (!ai.ok) {
        return json({ error: result?.error?.message || 'Groq request failed. Check the API key, model access, and usage limits.' }, 502);
      }
      reply = result?.choices?.[0]?.message?.content?.trim() || '';
    } else if (geminiKey) {
      const contents: any[] = [];
      for (const item of history) contents.push({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] });
      const parts: any[] = [];
      if (message) parts.push({ text: message });
      if (typeof body.image === 'string' && body.image.startsWith('data:image/')) {
        const match = body.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
      contents.push({ role: 'user', parts });
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
      const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents, generationConfig: { maxOutputTokens: 1600, temperature: 0.7 } })
      });
      const result = await ai.json();
      if (!ai.ok) {
        reply = await tryGroqFallback();
        if (!reply) return json({ error: result?.error?.message || 'Gemini failed and no configured backup provider could reply. Check provider keys and quotas.' }, 502);
      } else {
        reply = (result?.candidates?.[0]?.content?.parts || []).map((p: any) => typeof p.text === 'string' ? p.text : '').join('\n').trim();
      }
    } else if (openaiKey) {
      const ai = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini', instructions, input, tools: [{ type: 'web_search' }], max_output_tokens: 1600 })
      });
      const result = await ai.json();
      if (!ai.ok) {
        reply = await tryGroqFallback();
        if (!reply) return json({ error: result?.error?.message || 'OpenAI failed and no configured backup provider could reply. Check provider keys and quotas.' }, 502);
      } else {
        reply = (result.output || []).flatMap((item: any) => item.type === 'message' ? (item.content || []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text) : []).join('\n').trim();
      }
    }
    if (!reply) return json({ error: 'Smart AI returned an empty response. Please try again.' }, 502);
    // Keep a single cloud conversation across turns. The supplied ID is always scoped to the signed-in user.
    const title = (message || 'Image question').replace(/\s+/g, ' ').slice(0, 80) || 'New conversation';
    let conversation: { id: string } | null = null;
    const requestedId = typeof body.conversationId === 'string' ? body.conversationId : '';
    if (requestedId) {
      const { data } = await sb.from('conversations').select('id')
        .eq('id', requestedId).eq('user_id', user.id).maybeSingle();
      if (data?.id) {
        conversation = data;
        await sb.from('conversations').update({ updated_at: new Date().toISOString() })
          .eq('id', data.id).eq('user_id', user.id);
      }
    }
    if (!conversation) {
      const { data, error } = await sb.from('conversations')
        .insert({ user_id: user.id, title }).select('id').single();
      if (!error && data?.id) conversation = data;
    }
    if (conversation?.id) {
      const { error: saveError } = await sb.from('messages').insert([
        { conversation_id: conversation.id, user_id: user.id, role: 'user', content: message || '[Image attached]' },
        { conversation_id: conversation.id, user_id: user.id, role: 'assistant', content: reply },
      ]);
      if (saveError) console.error('Smart AI cloud history save failed:', saveError.message);
    }
    return json({ reply, conversationId: conversation?.id || null });
  } catch (e) {
    console.error('smart-assistant error', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
