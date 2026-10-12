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
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!apiKey || !supabaseUrl || !anonKey) return json({ error: 'Backend setup incomplete. Add OPENAI_API_KEY and Supabase environment settings.' }, 503);
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Please sign in to use Smart AI.' }, 401);
  const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401);
  try {
    const body = await req.json();
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
    const ai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini', instructions: 'You are Smart AI, a helpful, honest, warm general-purpose assistant. Answer clearly. Never claim to have performed an action you did not perform. If the user asks for current facts and web search is available, use it. Do not claim to generate an image unless image generation actually ran.', input, tools: [{ type: 'web_search' }], max_output_tokens: 1600 })
    });
    const result = await ai.json();
    if (!ai.ok) return json({ error: result?.error?.message || 'AI provider request failed. Check provider billing and model access.' }, 502);
    const reply = (result.output || []).flatMap((item: any) => item.type === 'message' ? (item.content || []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text) : []).join('\n').trim();
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
