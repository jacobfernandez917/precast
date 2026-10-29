#!/usr/bin/env node
/**
 * connect-agentbase — connect an existing Precast project to an AgentBase
 * Application, and prove the connection before anything is written.
 *
 *   pnpm connect                 # asks for whatever .env is missing; the secret is typed hidden
 *   pnpm connect --check         # verify what .env already holds; writes nothing
 *   pnpm connect --agentbase-url=… --agentbase-token-url=… --agentbase-client-id=… \
 *                --agentbase-client-secret=… --agentbase-model=<slug>
 *
 * Three checks in order, each with a sentence a person can act on when it
 * fails: the token URL accepts the id and secret; the API base lists the models
 * published to this Application; the chosen model is one of them. The
 * credentials are written to .env once the first two pass, the model once the
 * third does, so a half-finished connection can be completed by running again.
 *
 * `pnpm bootstrap` collects the same five values for a NEW project; this is the
 * same thing for a project that already exists or whose Application changed.
 *
 * The client secret is typed at a hidden prompt or passed as a flag, written to
 * .env and never printed. Tokens are minted for the checks and discarded.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnvFile, setEnvValue } from './provision-db.mjs';
import { restrictEnvFile } from './local-secrets.mjs';

export const FIELDS = [
  {
    env: 'AGENTBASE_URL',
    flag: 'agentbase-url',
    prompt: 'AgentBase API base URL (the API, not Studio; e.g. https://agentbase-api.example.com)',
  },
  {
    env: 'AGENTBASE_TOKEN_URL',
    flag: 'agentbase-token-url',
    prompt:
      'Token URL (on the Application\'s Precast tab in AgentBase Studio; ends in /protocol/openid-connect/token)',
  },
  { env: 'AGENTBASE_CLIENT_ID', flag: 'agentbase-client-id', prompt: 'Application client id' },
  {
    env: 'AGENTBASE_CLIENT_SECRET',
    flag: 'agentbase-client-secret',
    prompt: 'Application client secret (typed hidden)',
    secret: true,
  },
  {
    env: 'AGENTBASE_LLM_MODEL',
    flag: 'agentbase-model',
    prompt: 'Model slug (one published to this Application; leave blank to see the list first)',
    optional: true,
  },
];

const CREDENTIAL_FIELDS = FIELDS.filter((f) => f.env !== 'AGENTBASE_LLM_MODEL');

/** `.env.example` ships example.com addresses; discovery treats them as unset, and so does this. */
export function isPlaceholder(value) {
  return !value || /example\.com/i.test(value);
}

/** A failure at one named step, with the sentence to show and what to do about it. */
export class ConnectError extends Error {
  constructor(step, message, hint) {
    super(message);
    this.step = step;
    this.hint = hint;
  }
}

const STUDIO_CREDENTIALS =
  'In AgentBase Studio open Applications, then your application, then the Precast tab: it shows ' +
  'the Client ID, the client secret (with its own copy button), the Token URL and the AgentBase ' +
  'API base URL.';

function networkCode(err) {
  return err?.cause?.code ?? err?.code ?? err?.message ?? 'no response';
}

/** OAuth2 client_credentials, the same request the web app and the agents make. */
export async function mintToken({ tokenUrl, clientId, clientSecret, fetch = globalThis.fetch }) {
  let res;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    throw new ConnectError(
      'token',
      `Could not reach the token URL ${tokenUrl} (${networkCode(err)}).`,
      'Check the address and that you are online. ' + STUDIO_CREDENTIALS,
    );
  }
  if (res.status === 400 || res.status === 401) {
    throw new ConnectError(
      'token',
      'AgentBase rejected the client id or secret.',
      'Copy both again. ' +
        STUDIO_CREDENTIALS +
        ' If the secret was rotated, the old one no longer works.',
    );
  }
  if (!res.ok) {
    throw new ConnectError(
      'token',
      `The token URL answered HTTP ${res.status}: that address is not a token endpoint.`,
      STUDIO_CREDENTIALS,
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!json?.access_token) {
    throw new ConnectError(
      'token',
      'The token URL answered, but without an access token.',
      'That address is probably not the token endpoint. ' + STUDIO_CREDENTIALS,
    );
  }
  return json.access_token;
}

/** The models published to this Application, through AgentBase's own MCP tool. */
export async function listModels({ apiUrl, token, fetch = globalThis.fetch }) {
  const api = apiUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${api}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'agentbase.list_models', arguments: {} },
      }),
    });
  } catch (err) {
    throw new ConnectError(
      'models',
      `Could not reach the API base URL ${api} (${networkCode(err)}).`,
      'Check the address: it is the AgentBase API, not Studio. Another Precast project has it as ' +
        'AGENTBASE_URL in its .env; otherwise your AgentBase admin has it.',
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ConnectError(
      'models',
      `The token works, but the API at ${api} refused it (HTTP ${res.status}).`,
      'The API base URL and the token URL may belong to different AgentBase installations. ' +
        'Check both with your AgentBase admin.',
    );
  }
  if (!res.ok) {
    throw new ConnectError(
      'models',
      `The API at ${api} answered HTTP ${res.status} when asked for the model list.`,
      'Check that this is the AgentBase API base URL (it serves /mcp), not the Studio address.',
    );
  }
  const body = await res.json().catch(() => ({}));
  const text = body?.result?.content?.[0]?.text ?? '{}';
  if (body?.result?.isError) {
    throw new ConnectError(
      'models',
      `AgentBase could not list the models: ${text.slice(0, 200)}`,
      'Ask your AgentBase admin whether this Application may list models.',
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ConnectError(
      'models',
      'The API answered the model list in a form this script does not understand.',
      'The AgentBase version may be newer than this project. Update Precast (pnpm precast:update).',
    );
  }
  return payload.items ?? [];
}

/** Accept a slug, "<provider>/<model-id>" or a bare model id, like the agents do at runtime. */
export function findModel(items, wanted) {
  if (!wanted) return undefined;
  return items.find(
    (m) => m.slug === wanted || `${m.provider}/${m.modelId}` === wanted || m.modelId === wanted,
  );
}

/**
 * Run the three checks and produce the .env text to write. Throws a
 * ConnectError when the credentials themselves fail (nothing to write);
 * returns `ok: false` with the credentials already in `envText` when only the
 * model is missing or wrong, so the person can finish with one more run.
 */
export async function connect({
  values,
  envText = '',
  check = false,
  fetch = globalThis.fetch,
  log = console,
}) {
  const missing = CREDENTIAL_FIELDS.filter((f) => isPlaceholder(values[f.env])).map((f) => f.env);
  if (missing.length) {
    throw new ConnectError(
      'input',
      `Not enough to connect: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
      'Run pnpm connect without flags to be asked for each one. ' + STUDIO_CREDENTIALS,
    );
  }

  log.log('Connecting to AgentBase…');
  const token = await mintToken({
    tokenUrl: values.AGENTBASE_TOKEN_URL,
    clientId: values.AGENTBASE_CLIENT_ID,
    clientSecret: values.AGENTBASE_CLIENT_SECRET,
    fetch,
  });
  log.log("1/3 The token URL accepted the Application's id and secret.");

  const items = await listModels({ apiUrl: values.AGENTBASE_URL, token, fetch });
  const slugs = items
    .map((m) => m.slug)
    .filter(Boolean)
    .sort();
  log.log(
    `2/3 ${items.length} model${items.length === 1 ? '' : 's'} published to this Application` +
      (slugs.length ? `: ${slugs.join(', ')}.` : '.'),
  );

  let text = envText;
  const written = [];
  const write = (key, value) => {
    if (check) return;
    text = setEnvValue(text, key, value);
    written.push(key);
  };
  for (const f of CREDENTIAL_FIELDS) write(f.env, values[f.env]);

  const wanted = values.AGENTBASE_LLM_MODEL?.trim();
  const model = findModel(items, wanted);
  if (!items.length) {
    return {
      ok: false,
      step: 'model',
      envText: text,
      written,
      models: items,
      message: 'This Application has no published models yet, so the agents cannot answer.',
      hint: 'In Studio open Models and subscribe the Application to one, then run pnpm connect again.',
    };
  }
  if (!wanted) {
    return {
      ok: false,
      step: 'model',
      envText: text,
      written,
      models: items,
      message: 'No model chosen yet (AGENTBASE_LLM_MODEL is empty).',
      hint: `Pick one of: ${slugs.join(', ')}. Then: pnpm connect --agentbase-model=<slug>`,
    };
  }
  if (!model) {
    return {
      ok: false,
      step: 'model',
      envText: text,
      written,
      models: items,
      message: `The model "${wanted}" is not published to this Application.`,
      hint:
        `Published: ${slugs.join(', ')}. Use one of those (pnpm connect --agentbase-model=<slug>), ` +
        `or ask your AgentBase admin to subscribe the Application to "${wanted}".`,
    };
  }
  write('AGENTBASE_LLM_MODEL', model.slug ?? wanted);
  log.log(`3/3 The model ${model.slug ?? wanted} is published to this Application.`);
  return { ok: true, envText: text, written, models: items, model };
}

/**
 * Questions in the person's own terminal, with a way to ask one without echoing the answer.
 * readline echoes through its output stream, so the stream itself goes quiet for a secret:
 * overriding `rl._writeToOutput`, the usual trick, does nothing on current Node (25 calls an
 * internal method instead) and the secret was printed as it was typed.
 */
export function createPrompt({ input = stdin, output = stdout } = {}) {
  let muted = false;
  const quiet = new Writable({
    write(chunk, encoding, done) {
      if (!muted) output.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input, output: quiet, terminal: Boolean(input.isTTY) });
  return {
    ask: async (question) => (await rl.question(question)).trim(),
    askHidden: async (question) => {
      output.write(question);
      muted = true;
      try {
        return (await rl.question('')).trim();
      } finally {
        muted = false;
        output.write('\n');
      }
    },
    close: () => rl.close(),
  };
}

/** Prompt in the person's own terminal; the secret is not echoed. */
async function askValue(field) {
  const prompt = createPrompt();
  try {
    return field.secret
      ? await prompt.askHidden(`${field.prompt}: `)
      : await prompt.ask(`${field.prompt}: `);
  } finally {
    prompt.close();
  }
}

export function parseFlags(args) {
  const flags = {};
  for (const a of args) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    flags[k] = rest.length ? rest.join('=') : true;
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const check = flags.check === true;
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const current = parseEnvFile(envText);

  const values = {};
  for (const f of FIELDS) {
    const fromFlag = typeof flags[f.flag] === 'string' ? flags[f.flag] : undefined;
    // A secret pasted into the chat arrives in the environment, never on the command line.
    const fromShell = f.secret ? process.env[f.env]?.trim() || undefined : undefined;
    const fromEnv = isPlaceholder(current[f.env]) ? '' : current[f.env];
    values[f.env] = (fromFlag ?? fromShell ?? fromEnv ?? '').trim();
  }

  if (!check && stdin.isTTY) {
    for (const f of FIELDS) {
      if (values[f.env]) continue;
      if (f.optional) continue;
      values[f.env] = await askValue(f);
    }
  }

  const result = await connect({ values, envText, check, log: console });
  if (result.written.length) {
    writeFileSync(envPath, result.envText);
    restrictEnvFile(envPath);
    console.log(`Wrote into .env: ${result.written.join(', ')}.`);
  }
  if (!result.ok) {
    console.error(`\n✖ ${result.message}`);
    if (result.hint) console.error(`  ${result.hint}`);
    if (result.written.length) {
      console.error('  The credentials are saved; only the model is missing.');
    }
    process.exit(1);
  }
  if (check) console.log('\n✅ Connected to AgentBase (nothing written; --check).');
  else console.log('\n✅ Connected to AgentBase. Next: pnpm poc, then say "show it to me".');
}

/** One line a person can act on, with where to look; the full error only when asked for. */
function exitWithReason(err) {
  console.error(`\n✖ ${err?.message ?? err}`);
  if (err instanceof ConnectError && err.hint) console.error(`  ${err.hint}`);
  if (process.env.PRECAST_DEBUG) console.error(err?.stack ?? err);
  else if (!(err instanceof ConnectError))
    console.error('  (PRECAST_DEBUG=1 shows the full error.)');
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(exitWithReason);
}
