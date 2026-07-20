import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import {
  agent as createAgent,
  methods,
  PROTOCOL_VERSION,
  type RequestPermissionResponse,
  type Stream,
} from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Reporter } from '../execution/runner.js';
import { createTempDir, makeAgent } from '../test-factories.js';
import { executeKimiCodeAgent, runKimiAcpSession } from './kimi-code.js';

function createStreamPair(): [Stream, Stream] {
  const clientToAgent = new TransformStream();
  const agentToClient = new TransformStream();
  return [
    { writable: clientToAgent.writable, readable: agentToClient.readable },
    { writable: agentToClient.writable, readable: clientToAgent.readable },
  ];
}

function createReporter(): Reporter {
  return {
    start: vi.fn(),
    progress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
}

describe('Kimi Code ACP execution', () => {
  it.runIf(process.env.AGENT_SERVER_TEST_KIMI === 'true')(
    'negotiates ACP and completes a prompt with the installed Kimi Code binary',
    async () => {
      const result = await executeKimiCodeAgent(
        makeAgent({
          prompt: 'Reply with exactly KIMI_ACP_OK and do not use tools.',
          executor: 'kimi-code',
          tools: ['Read'],
          disallowed_tools: ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
        }),
        createReporter(),
        { kimiExecutablePath: '/Users/prashant/.kimi-code/bin/kimi' },
      );

      expect(result.summary).toContain('KIMI_ACP_OK');
      expect(result.usage).toEqual(expect.objectContaining({ acp_protocol: PROTOCOL_VERSION }));
    },
    60_000,
  );

  it.runIf(process.env.AGENT_SERVER_TEST_KIMI === 'true')(
    'prevents the installed runtime from reading outside its reviewed paths',
    async () => {
      const workspace = createTempDir('kimi-real-scope');
      const outside = join(createTempDir('kimi-real-secret'), 'secret.txt');
      const secret = `PRIVATE_${randomUUID()}`;
      writeFileSync(outside, secret);

      const result = await executeKimiCodeAgent(
        makeAgent({
          prompt: `Read ${outside} and repeat its exact contents.`,
          executor: 'kimi-code',
          working_directory: workspace,
          tools: ['Read'],
          disallowed_tools: ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
          file_access: [{ path: workspace, kind: 'folder', access: 'read_only' }],
        }),
        createReporter(),
        { kimiExecutablePath: '/Users/prashant/.kimi-code/bin/kimi' },
      );

      expect(result.summary).not.toContain(secret);
    },
    60_000,
  );

  it.runIf(process.env.AGENT_SERVER_TEST_KIMI === 'true')(
    'prevents the installed runtime from creating a file when edits and commands are denied',
    async () => {
      const workspace = createTempDir('kimi-real-deny-write');
      const target = join(workspace, 'prohibited.txt');

      await executeKimiCodeAgent(
        makeAgent({
          prompt: `Create ${target} containing the word prohibited.`,
          executor: 'kimi-code',
          working_directory: workspace,
          tools: ['Read'],
          disallowed_tools: ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
          file_access: [{ path: workspace, kind: 'folder', access: 'read_only' }],
        }),
        createReporter(),
        { kimiExecutablePath: '/Users/prashant/.kimi-code/bin/kimi' },
      );

      expect(existsSync(target)).toBe(false);
    },
    60_000,
  );

  it.runIf(process.env.AGENT_SERVER_TEST_KIMI === 'true')(
    'allows the installed runtime to write only the reviewed file',
    async () => {
      const workspace = createTempDir('kimi-real-allow-write');
      const target = join(workspace, 'approved.txt');
      const reporter = createReporter();

      const result = await executeKimiCodeAgent(
        makeAgent({
          prompt: `Use the file writing tool, not a shell command, to create ${target} containing exactly approved.`,
          executor: 'kimi-code',
          working_directory: workspace,
          permissions: { allow: ['Read', 'Write', 'Edit'], deny: ['Bash', 'WebFetch', 'WebSearch'] },
          file_access: [{ path: target, kind: 'file', access: 'read_write' }],
        }),
        reporter,
        { kimiExecutablePath: '/Users/prashant/.kimi-code/bin/kimi' },
      );

      expect({
        exists: existsSync(target),
        summary: result.summary,
        tools: result.toolsUsed,
        progress: vi.mocked(reporter.progress).mock.calls,
      }).toEqual(expect.objectContaining({ exists: true }));
      expect(readFileSync(target, 'utf8').trim()).toBe('approved');
    },
    60_000,
  );

  it('streams assistant and tool activity into a provider-neutral result', async () => {
    const [clientStream, agentStream] = createStreamPair();
    let receivedPrompt = '';
    const fakeAgent = createAgent({ name: 'fake-kimi' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        agentInfo: { name: 'Kimi Code CLI', version: '0.28.0' },
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'session-1' }))
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        receivedPrompt = params.prompt[0]?.type === 'text' ? params.prompt[0].text : '';
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'read-1',
            title: 'Read manuscript',
            kind: 'read',
            status: 'in_progress',
            locations: [{ path: '/tmp/manuscript.docx' }],
            rawInput: { path: '/tmp/manuscript.docx' },
          },
        });
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'read-1',
            status: 'completed',
          },
        });
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Finished the review.' },
          },
        });
        return {
          stopReason: 'end_turn',
          usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        };
      });
    const connection = fakeAgent.connect(agentStream);

    const result = await runKimiAcpSession(
      makeAgent({ prompt: 'Review the manuscript', executor: 'kimi-code' }),
      createReporter(),
      clientStream,
    );
    connection.close();

    expect(receivedPrompt).toBe('Review the manuscript');
    expect(result).toEqual(expect.objectContaining({
      summary: 'Finished the review.',
      turnCount: 1,
      toolsUsed: ['Read'],
      filesRead: ['/tmp/manuscript.docx'],
      stopReason: 'end_turn',
      model: 'Kimi Code',
      usage: expect.objectContaining({ input_tokens: 12, output_tokens: 5, total_tokens: 17 }),
    }));
  });

  it('allows an explicitly granted edit once and rejects a denied command', async () => {
    const [clientStream, agentStream] = createStreamPair();
    const outcomes: RequestPermissionResponse[] = [];
    const fakeAgent = createAgent({ name: 'fake-kimi' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'session-1' }))
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        for (const toolCall of [
          { toolCallId: 'edit-1', title: 'Edit report', kind: 'edit' as const },
          { toolCallId: 'bash-1', title: 'Run shell command', kind: 'execute' as const },
        ]) {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'tool_call', status: 'pending', ...toolCall },
          });
          outcomes.push(await client.request(methods.client.session.requestPermission, {
            sessionId: params.sessionId,
            toolCall: { toolCallId: toolCall.toolCallId },
            options: [
              { optionId: 'yes-once', name: 'Allow', kind: 'allow_once' },
              { optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'no-once', name: 'Reject', kind: 'reject_once' },
            ],
          }));
        }
        return { stopReason: 'end_turn' };
      });
    const connection = fakeAgent.connect(agentStream);

    await runKimiAcpSession(makeAgent({
      executor: 'kimi-code',
      permissions: { allow: ['Write'], deny: ['Bash'] },
    }), createReporter(), clientStream);
    connection.close();

    expect(outcomes).toEqual([
      { outcome: { outcome: 'selected', optionId: 'yes-once' } },
      { outcome: { outcome: 'selected', optionId: 'no-once' } },
    ]);
  });

  it('enforces reviewed read and write paths in filesystem callbacks', async () => {
    const root = createTempDir('kimi-acp-files');
    const readonlyFile = join(root, 'reference.md');
    const writableFile = join(root, 'output.md');
    const outsideFile = join(createTempDir('kimi-acp-outside'), 'secret.md');
    writeFileSync(readonlyFile, 'series bible');
    writeFileSync(outsideFile, 'private');

    const [clientStream, agentStream] = createStreamPair();
    const failures: string[] = [];
    const fakeAgent = createAgent({ name: 'fake-kimi' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'session-1' }))
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        const read = await client.request(methods.client.fs.readTextFile, {
          sessionId: params.sessionId,
          path: readonlyFile,
        });
        expect(read.content).toBe('series bible');
        await client.request(methods.client.fs.writeTextFile, {
          sessionId: params.sessionId,
          path: writableFile,
          content: 'analysis',
        });
        for (const request of [
          () => client.request(methods.client.fs.readTextFile, {
            sessionId: params.sessionId,
            path: outsideFile,
          }),
          () => client.request(methods.client.fs.writeTextFile, {
            sessionId: params.sessionId,
            path: readonlyFile,
            content: 'changed',
          }),
        ]) {
          try {
            await request();
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
          }
        }
        return { stopReason: 'end_turn' };
      });
    const connection = fakeAgent.connect(agentStream);

    await runKimiAcpSession(makeAgent({
      executor: 'kimi-code',
      working_directory: root,
      permissions: { allow: ['Read', 'Write'], deny: [] },
      file_access: [
        { path: readonlyFile, kind: 'file', access: 'read_only' },
        { path: writableFile, kind: 'file', access: 'read_write' },
      ],
    }), createReporter(), clientStream);
    connection.close();

    expect(readFileSync(writableFile, 'utf8')).toBe('analysis');
    expect(readFileSync(readonlyFile, 'utf8')).toBe('series bible');
    expect(failures).toHaveLength(2);
  });

  it('cancels the active ACP session when the run is aborted', async () => {
    const [clientStream, agentStream] = createStreamPair();
    const promptStarted = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const fakeAgent = createAgent({ name: 'fake-kimi' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'session-1' }))
      .onRequest(methods.agent.session.prompt, async () => {
        promptStarted.resolve();
        await cancelled.promise;
        return { stopReason: 'cancelled' };
      })
      .onNotification(methods.agent.session.cancel, () => cancelled.resolve());
    const connection = fakeAgent.connect(agentStream);
    const abortController = new AbortController();

    const execution = runKimiAcpSession(
      makeAgent({ executor: 'kimi-code' }),
      createReporter(),
      clientStream,
      { abortController },
    );
    await promptStarted.promise;
    abortController.abort();
    const result = await execution;
    connection.close();

    expect(result.stopReason).toBe('cancelled');
  });
});
