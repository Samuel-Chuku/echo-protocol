import { config } from '../config.js';

/**
 * The agent's LLM brain (#4). Two judgements, both against requester-written natural-language criteria:
 *   1. screenPreview  — score a PUBLIC preview 0-100 to decide whether to pay to reveal.
 *   2. evaluateGuardrails — after reveal, decide if the full submission CLEARLY meets the requester's
 *      stringent bar for auto-advancing to Shortlist. Anything short of clearly-met defers to a human.
 *
 * Calls OpenRouter (OpenAI-compatible chat-completions) so any model slug in config.openrouterModel
 * works. No SDK dep. The caller only runs this when the agent is enabled and the key is present.
 */

async function callLLM(system: string, user: string, maxTokens = 512): Promise<string> {
  if (!config.openrouterApiKey) throw new Error('OPENROUTER_API_KEY missing');
  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openrouterApiKey}`,
      'HTTP-Referer': 'https://echoprotocol.site', // OpenRouter attribution (optional)
      'X-Title': 'Echo Protocol Agent',
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/** Extract the first JSON object from a model reply (tolerates prose/code-fences around it). */
function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON in model reply: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export interface RevealScore { score: number; reason: string }

/** Score how well a public preview meets the requester's reveal criteria. 0-100; higher = more worth revealing. */
export async function screenPreview(preview: string, revealCriteria: string): Promise<RevealScore> {
  const system =
    'You are a hiring screener for a decentralized work market. Given a REQUESTER\'S CRITERIA and an ' +
    'APPLICANT\'S PUBLIC PREVIEW, score 0-100 how well the preview suggests this applicant is worth ' +
    'paying a fee to reveal in full. Be decisive but fair; a vague or off-topic preview scores low. ' +
    'Reply ONLY with JSON: {"score": <0-100 int>, "reason": "<one sentence>"}.';
  const user = `REQUESTER'S CRITERIA:\n${revealCriteria}\n\nAPPLICANT'S PUBLIC PREVIEW:\n${preview || '(no preview provided)'}`;
  const out = parseJson<RevealScore>(await callLLM(system, user, 256));
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  return { score, reason: String(out.reason ?? '').slice(0, 300) };
}

export interface GuardrailVerdict { met: boolean; confidence: number; reason: string }

/**
 * Decide if the full submission CLEARLY meets the requester's advancement guardrails. Returns met=true
 * ONLY when confident; the loop treats met=false OR low confidence as "defer to human" (rank, no advance).
 * `files` is a short list of attachment descriptors (name/type) — full binary parsing is out of scope.
 */
export async function evaluateGuardrails(
  submission: string, files: { filename: string; mime: string }[], advanceGuardrails: string,
): Promise<GuardrailVerdict> {
  const fileList = files.length ? files.map((f) => `- ${f.filename} (${f.mime})`).join('\n') : '(none)';
  const system =
    'You are an autonomous hiring agent deciding whether to ADVANCE an applicant to the shortlist. Advancing ' +
    'is consequential, so only say met=true when the submission CLEARLY and unambiguously satisfies EVERY ' +
    'guardrail. If anything is unclear, missing, or borderline, set met=false so a human decides. Reply ONLY ' +
    'with JSON: {"met": <bool>, "confidence": <0-100 int>, "reason": "<one sentence>"}.';
  const user =
    `REQUESTER'S ADVANCEMENT GUARDRAILS (all must be clearly met):\n${advanceGuardrails}\n\n` +
    `APPLICANT'S FULL SUBMISSION:\n${submission || '(empty)'}\n\nATTACHED FILES:\n${fileList}`;
  const out = parseJson<GuardrailVerdict>(await callLLM(system, user, 384));
  return {
    met: Boolean(out.met),
    confidence: Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0))),
    reason: String(out.reason ?? '').slice(0, 300),
  };
}
