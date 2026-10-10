// Checks the Vaani and Gemini keys in .env.local without printing them.
// Usage: npm run check-keys
const ok = (m: string) => console.log(`✓ ${m}`);
const bad = (m: string) => console.log(`✗ ${m}`);

async function vaani() {
  const key = process.env.VAANI_API_KEY;
  const agentId = process.env.VAANI_AGENT_ID;
  if (!key) return bad('VAANI_API_KEY is empty');
  const res = await fetch('https://api.vaanivoice.ai/api/agents', { headers: { 'X-API-Key': key } });
  if (!res.ok) return bad(`Vaani rejected the key (HTTP ${res.status})`);
  const body = (await res.json()) as unknown;
  const list = Array.isArray(body) ? body : ((body as { agents?: unknown[]; items?: unknown[] }).agents ?? (body as { items?: unknown[] }).items ?? []);
  const found = (list as { agent_id?: string; id?: string; agent_display_name?: string }[]).find(
    (a) => a.agent_id === agentId || a.id === agentId,
  );
  if (found) ok(`Vaani key works; agent found${found.agent_display_name ? ` ("${found.agent_display_name}")` : ''}`);
  else bad(`Vaani key works, but agent ${agentId} is not in this account (${list.length} agents found)`);
}

async function gemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return bad('GEMINI_API_KEY is empty');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return bad(`Gemini rejected the key (HTTP ${res.status}): ${(await res.text()).slice(0, 160)}`);
  const { models = [] } = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const flash = models
    .filter((m) => /flash/i.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  ok(`Gemini key works; ${flash.length} Flash models available`);
  console.log(`  Flash models: ${flash.join(', ')}`);
  const model = process.env.GEMINI_MODEL;
  if (!model) bad('GEMINI_MODEL is empty: pick one of the Flash models above');
  else if (flash.includes(model)) ok(`GEMINI_MODEL "${model}" is available`);
  else bad(`GEMINI_MODEL "${model}" is not in the list above`);
}

await vaani().catch((e) => bad(`Vaani check failed: ${(e as Error).message}`));
await gemini().catch((e) => bad(`Gemini check failed: ${(e as Error).message}`));
