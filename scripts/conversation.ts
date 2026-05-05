import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs/promises';
import type {
  AgentSession,
  IMemoryAdapter,
  SessionMessage,
} from '../adapters/memory/IMemoryAdapter.js';

loadDotenv({ override: true });

type Command = 'list' | 'show' | 'append' | 'import' | 'help';
type Role = SessionMessage['role'];

interface ParsedArgs {
  command: Command;
  positionals: string[];
  flags: Record<string, string | true>;
}

const args = parseArgs(process.argv.slice(2));

if (args.command === 'help') {
  printHelp();
  process.exit(0);
}

const agentId = readStringFlag(args, 'agent') ?? process.env['AGENT_ID'] ?? 'claw-agent-0';
const memory = await buildMemoryAdapter();

switch (args.command) {
  case 'list':
    await listSessions(memory, agentId);
    break;
  case 'show':
    await showSession(memory, agentId, args);
    break;
  case 'append':
    await appendMessage(memory, agentId, args);
    break;
  case 'import':
    await importMessages(memory, agentId, args);
    break;
  default:
    assertNever(args.command);
}

async function buildMemoryAdapter(): Promise<IMemoryAdapter> {
  const adapter = (process.env['MEMORY_ADAPTER'] ?? 'local').toLowerCase();

  if (adapter === '0g') {
    const rpc = process.env['OG_STORAGE_RPC'];
    const indexer = process.env['OG_STORAGE_INDEXER'];
    const privateKey = process.env['OG_PRIVATE_KEY'];
    const kvRpc = process.env['OG_KV_RPC'];

    if (!rpc || !indexer || !privateKey) {
      throw new Error(
        'MEMORY_ADAPTER=0g requires OG_STORAGE_RPC, OG_STORAGE_INDEXER, and OG_PRIVATE_KEY',
      );
    }

    const { OGMemoryAdapter } = await import('../adapters/memory/0GMemoryAdapter.js');
    return new OGMemoryAdapter(
      kvRpc
        ? { rpc, indexer, privateKey, kvRpc }
        : { rpc, indexer, privateKey },
    );
  }

  const { LocalMemoryAdapter } = await import('../adapters/memory/LocalMemoryAdapter.js');
  const storageDir = process.env['LOCAL_STORAGE_PATH'];
  return storageDir ? new LocalMemoryAdapter({ storageDir }) : new LocalMemoryAdapter();
}

async function listSessions(memory: IMemoryAdapter, agentId: string): Promise<void> {
  const ids = await memory.listSessions(agentId);
  if (ids.length === 0) {
    console.log(`No sessions found for agent "${agentId}".`);
    return;
  }

  for (const id of ids.sort()) {
    console.log(id);
  }
}

async function showSession(
  memory: IMemoryAdapter,
  agentId: string,
  args: ParsedArgs,
): Promise<void> {
  const sessionId = requiredSessionId(args);
  const session = await memory.loadSession(agentId, sessionId);
  if (session === null) {
    throw new Error(`No session "${sessionId}" found for agent "${agentId}"`);
  }

  const history = await memory.loadHistory(agentId, sessionId);
  const format = readStringFlag(args, 'format') ?? 'markdown';

  if (format === 'json') {
    console.log(JSON.stringify({ session, history }, null, 2));
    return;
  }

  if (format !== 'markdown') {
    throw new Error(`Unsupported --format "${format}". Use markdown or json.`);
  }

  console.log(renderMarkdown(session, history));
}

async function appendMessage(
  memory: IMemoryAdapter,
  agentId: string,
  args: ParsedArgs,
): Promise<void> {
  const sessionId = requiredSessionId(args);
  const role = readStringFlag(args, 'role');
  const content = readStringFlag(args, 'content');

  if (!isRole(role)) throw new Error('--role must be user, assistant, or system');
  if (content === undefined || content.trim().length === 0) {
    throw new Error('--content is required');
  }

  await persistMessage(memory, agentId, sessionId, {
    role,
    content: content.trim(),
    timestamp: Date.now(),
  });

  console.log(`Saved ${role} message to ${agentId}/${sessionId}.`);
}

async function importMessages(
  memory: IMemoryAdapter,
  agentId: string,
  args: ParsedArgs,
): Promise<void> {
  const sessionId = requiredSessionId(args);
  const file = readStringFlag(args, 'file');
  if (file === undefined || file.trim().length === 0) {
    throw new Error('--file is required');
  }

  const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('import file must be a JSON array of SessionMessage objects');
  }

  for (const item of parsed) {
    const message = normalizeMessage(item);
    await persistMessage(memory, agentId, sessionId, message);
  }

  console.log(`Imported ${parsed.length} message(s) into ${agentId}/${sessionId}.`);
}

async function persistMessage(
  memory: IMemoryAdapter,
  agentId: string,
  sessionId: string,
  message: SessionMessage,
): Promise<void> {
  let session = await memory.loadSession(agentId, sessionId);
  const now = Date.now();
  if (session === null) {
    session = {
      agentId,
      sessionId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: { source: 'conversation-cli' },
    };
  }

  await memory.appendMessage(agentId, sessionId, message);
  await memory.saveSession({
    ...session,
    updatedAt: now,
    messages: [...session.messages, message],
  });
}

function renderMarkdown(session: AgentSession, history: SessionMessage[]): string {
  const lines = [
    `# Conversation ${session.sessionId}`,
    '',
    `Agent: ${session.agentId}`,
    `Created: ${new Date(session.createdAt).toISOString()}`,
    `Updated: ${new Date(session.updatedAt).toISOString()}`,
    `Messages: ${history.length}`,
    '',
  ];

  for (const message of history) {
    lines.push(`## ${message.role} - ${new Date(message.timestamp).toISOString()}`);
    lines.push('');
    lines.push(message.content);
    lines.push('');
  }

  return lines.join('\n');
}

function normalizeMessage(value: unknown): SessionMessage {
  if (typeof value !== 'object' || value === null) {
    throw new Error('each imported message must be an object');
  }

  const candidate = value as Partial<SessionMessage>;
  if (!isRole(candidate.role)) {
    throw new Error('each imported message needs role: user | assistant | system');
  }
  if (typeof candidate.content !== 'string' || candidate.content.trim().length === 0) {
    throw new Error('each imported message needs non-empty content');
  }

  return {
    role: candidate.role,
    content: candidate.content.trim(),
    timestamp: typeof candidate.timestamp === 'number' ? candidate.timestamp : Date.now(),
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = parseCommand(argv[0]);
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { command, positionals, flags };
}

function parseCommand(value: string | undefined): Command {
  if (value === 'list' || value === 'show' || value === 'append' || value === 'import') {
    return value;
  }
  return 'help';
}

function requiredSessionId(args: ParsedArgs): string {
  const sessionId = args.positionals[0] ?? readStringFlag(args, 'session');
  if (sessionId === undefined || sessionId.trim().length === 0) {
    throw new Error('sessionId is required');
  }
  return sessionId;
}

function readStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

function isRole(value: unknown): value is Role {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function assertNever(value: never): never {
  throw new Error(`Unexpected command: ${String(value)}`);
}

function printHelp(): void {
  console.log(`0G-Claw conversation sessions

Usage:
  pnpm conversation list [--agent claw-agent-0]
  pnpm conversation show <sessionId> [--agent claw-agent-0] [--format markdown|json]
  pnpm conversation append <sessionId> --role user|assistant|system --content "..."
  pnpm conversation import <sessionId> --file messages.json

Backends:
  MEMORY_ADAPTER=local uses LOCAL_STORAGE_PATH or ~/.0g-claw.
  MEMORY_ADAPTER=0g uses OG_STORAGE_RPC, OG_STORAGE_INDEXER, OG_PRIVATE_KEY.
  Set OG_KV_RPC to use native 0G KV for cross-device recovery by sessionId.
`);
}
