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
      const isEdit = body.action === 'edit_image';
      const prompt = String(body.prompt || body.message || '').trim();
      if (!prompt) return json({ error: 'Describe the image you want to create or edit.' }, 400);
      if (prompt.length > 4000) return json({ error: 'Please keep image descriptions under 4,000 characters.' }, 413);
      let sourceImage: { mimeType: string; data: string } | null = null;
      if (isEdit) {
        if (typeof body.image !== 'string') return json({ error: 'Choose a PNG, JPEG, or WebP image to edit first.' }, 400);
        if (body.image.length > 11_000_000) return json({ error: 'Image is too large. Choose a smaller image.' }, 413);
        const match = body.image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) return json({ error: 'The selected image format is not supported. Use PNG, JPEG, or WebP.' }, 400);
        sourceImage = { mimeType: match[1], data: match[2] };
      }

      // Prefer OpenAI when configured. If it is unavailable or out of credits, try Gemini image generation.
      let providerError = '';
      if (openaiKey) {
        try {
          let imageResponse: Response;
          if (isEdit && sourceImage) {
            const bytes = Uint8Array.from(atob(sourceImage.data), (ch) => ch.charCodeAt(0));
            const ext = sourceImage.mimeType === 'image/jpeg' ? 'jpg' : sourceImage.mimeType.split('/')[1];
            const form = new FormData();
            form.append('model', Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1');
            form.append('prompt', prompt);
            form.append('size', '1024x1024');
            form.append('image', new Blob([bytes], { type: sourceImage.mimeType }), `upload.${ext}`);
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
          const result = await imageResponse.json();
          if (imageResponse.ok && result?.data?.[0]?.b64_json) {
            return json({ image: `data:image/png;base64,${result.data[0].b64_json}`, provider: 'openai' });
          }
          providerError = result?.error?.message || 'OpenAI image generation is unavailable.';
        } catch (err) {
          providerError = String(err instanceof Error ? err.message : err);
        }
      }

      if (geminiKey) {
        try {
          const parts: any[] = [{ text: prompt }];
          if (sourceImage) parts.push({ inlineData: sourceImage });
          const model = Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-3.1-flash-image';
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
            })
          });
          const result = await response.json();
          if (response.ok) {
            const returnedParts = result?.candidates?.[0]?.content?.parts || [];
            const generated = returnedParts.find((part: any) => part?.inlineData?.data && String(part?.inlineData?.mimeType || '').startsWith('image/'));
            if (generated) {
              return json({ image: `data:${generated.inlineData.mimeType};base64,${generated.inlineData.data}`, provider: 'gemini' });
            }
            providerError = 'Gemini responded without an image. Check image-model access and try again.';
          } else {
            providerError = result?.error?.message || 'Gemini image generation is unavailable.';
          }
        } catch (err) {
          providerError = String(err instanceof Error ? err.message : err);
        }
      }
      if (!openaiKey && !geminiKey) {
        return json({ error: 'Image generation needs an OPENAI_API_KEY or GEMINI_API_KEY with image-model access. Add the key as a Supabase Edge Function secret.' }, 503);
      }
      return json({ error: providerError || 'Image generation failed. Check provider access and usage limits.' }, 502);
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
    let instructions = 'You are Smart AI, a capable, natural, accurate assistant. Smart AI was founded and is owned by Monday Light. If asked who founded, owns, or created Smart AI, answer: Monday Light. Do not invent personal details about Monday Light. If asked your name, say Smart AI.\n\nRESPONSE STYLE (important): Answer the exact question immediately. Put the useful answer first. Keep the default answer brief and natural, like a helpful expert in a conversation. Do not ramble, repeat the question, add an introduction, explain your reasoning unnecessarily, or include unrelated advice. Do not use numbered lists, headings, bullet points, or long step-by-step explanations unless the user asks for a list, steps, or detailed explanation, or the task genuinely requires a structured format. For a simple question, use one or a few clear sentences. For a direct factual question, answer directly rather than describing the topic around it. If a question is ambiguous and the missing detail changes the answer, ask one short clarifying question; otherwise make a reasonable interpretation and answer. If the user might benefit from more depth, finish with a brief invitation such as "Want me to explain more?" Do not attach that invitation to every response. Match the user’s tone and requested format. For writing, translation, rewriting, and code requests, provide the requested output directly without unnecessary commentary. Use plain language and correct mistakes rather than agreeing with false claims. Be honest about uncertainty and limitations. Never invent sources, citations, URLs, facts, or claim an action succeeded unless it did.\n\nFor greetings, simple arithmetic, translation, rewriting, creative writing, and stable everyday explanations, answer directly without web search. For current events, recent developments, current prices, laws or policies, specific named entities, important health/financial/safety facts, or whenever the user asks you to verify or search, use the enabled browser_search tool before answering. Prefer primary and official sources, cross-check important claims when practical, and include clickable source links for researched claims. If asked to create an image, use the image-generation action rather than explaining how. If blocked, state the specific reason briefly.';\n    const { data: preferences } = await sb.from('user_preferences').select('memory_enabled,memory_text')
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
      const imageAttached = typeof body.image === 'string' && body.image.startsWith('data:image/') && body.image.includes(';base64,');
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
