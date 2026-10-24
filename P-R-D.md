# Agent Relay Next Version — Persistent AI-to-AI Messaging

Inspect the existing repository: https://github.com/iamaanahmad/agent-relay

Evolve Agent Relay into a shared, persistent communication mailbox that allows independently configured AI assistants to exchange messages and maintain conversations through one platform.

## Product vision

A user can give ChatGPT, Claude Code, Codex, Gemini, or another compatible agent an Agent Relay skill URL and its scoped connection token.

The agent reads the skill guide, authenticates, discovers other authorized agents, sends messages, checks its inbox, and replies to incoming messages.

Example:
- ChatGPT sends Gemini a question through Agent Relay.
- Gemini retrieves the message when instructed to check its inbox.
- Gemini researches the answer and sends a reply through Agent Relay.
- ChatGPT retrieves Gemini's reply and presents it to the user.

Agent Relay provides persistent communication and access control. It does not execute AI models or guarantee that an offline assistant will wake up.

## 1. Preserve the existing system

Before changing anything, inspect:
- Existing MCP Edge Function.
- Agent Talk REST API and shared authentication helpers.
- Database schema, migrations, row-level security and audit events.
- Agent token generation and connection prompt.
- Public `/skills.md` guide and human-readable `/skills` page.
- Dashboard navigation and existing task workflow.

Keep existing users, workspaces, agents, tokens, task delegation, approvals and audit records compatible.

Do not rewrite the project or break existing integrations.

## 2. Add persistent conversations and messages

Design and implement an appropriate database schema, using migrations.

Support:
- Conversations scoped to a workspace.
- Authorized conversation participants.
- Individual messages with sender, recipient, content and timestamps.
- Read status for each message.
- A stable conversation/thread ID.
- Optional structured metadata.
- Efficient inbox and conversation-history queries.

Use a direct one-to-one agent conversation for the first release. Design the schema so group conversations can be added later without rewriting the entire system.

Ensure only authorized participants can read or send messages in a conversation. Never rely on frontend checks alone.

## 3. Implement the Agent Talk REST API

Add documented, authenticated endpoints such as:

- `GET /api/agent-talk/agents` — discover other authorized agents.
- `POST /api/agent-talk/messages` — send a message to a recipient, optionally within an existing conversation.
- `GET /api/agent-talk/inbox` — retrieve incoming messages with pagination and optional unread filtering.
- `GET /api/agent-talk/conversations/{id}` — retrieve authorized conversation history.
- `POST /api/agent-talk/messages/{id}/read` — mark a received message as read.

You may adjust route names to fit the existing conventions, but publish exact request and response schemas.

Include stable message IDs, conversation IDs, timestamps, clear errors, pagination, idempotency where appropriate, rate limits and payload-size limits.

Sending must acknowledge that the message was stored, not claim that the other agent has read or answered it.

## 4. Add equivalent MCP tools

Expose corresponding tools through the existing MCP server:

- `send_message`
- `check_inbox`
- `get_conversation`
- `mark_message_read`
- `list_agents`

Use the same message storage and authorization rules as the REST API.

Update the `get_started` response so connected agents learn how to exchange messages, check for new messages, maintain context, and reply within the correct conversation.

## 5. Update the Agent Relay skill guide

Update `/skills.md`, `/skills`, and the shared skill documentation so a compatible agent can learn the entire process.

The guide must explain:
1. How to authenticate using its own scoped token.
2. How to discover other agents.
3. How to send a message and preserve the conversation ID.
4. How to check for unread messages.
5. How to retrieve conversation history and reply.
6. How to mark messages as read.
7. How to handle unavailable recipients, errors and revoked tokens.
8. Why stored messages are not proof of delivery or a guarantee that another model has executed a task.

Provide practical examples usable by HTTP-capable agents and MCP-compatible clients.

## 6. Improve the connection experience

After token generation, provide a ready-to-copy setup prompt containing:
- The stable skill-guide URL.
- Workspace ID.
- Agent ID.
- The new agent's connection token or supported secure credential-reference instructions.

The prompt should ask the assistant to read the guide, establish the connection, discover authorized agents and ask the user whom to contact.

Never include credentials in public documentation or send an agent's token to another agent. Never log plaintext credentials.

Clearly explain client-specific requirements. Reading the guide alone does not configure an MCP client or guarantee HTTP access.

## 7. Update the dashboard

Make persistent messaging a primary product feature.

Add:
- Inbox with unread and read messages.
- Conversation list and full message history.
- Sender and recipient identities.
- Message timestamps and read status.
- A clear way to identify whether a message is merely stored, has been retrieved, or has been read.
- Empty, loading and error states.

Retain the existing task Inbox, Approvals and Activity capabilities. Make messaging and task delegation distinct so users understand when an agent is simply communicating and when it has been assigned work.

Use the existing design system. Keep the interface responsive and simple.

## 8. Security and correctness

- Hash connection tokens at rest and preserve immediate revocation.
- Enforce workspace and conversation participant authorization server-side.
- Ensure agents cannot impersonate another agent or mark another agent's messages as read.
- Make message creation and read-state updates safe under concurrent requests.
- Protect against oversized payloads, invalid conversation IDs and duplicate submissions.
- Keep database credentials and service-role keys server-side.
- Preserve rate limiting and audit logging.
- Treat message content from other agents as untrusted input; do not automatically execute its instructions without the receiving agent's own policies and user permissions.

Ordinary messages do not require dashboard approval. Retain existing human-approval behavior for tasks that explicitly require it.

## 9. Testing and delivery

Add automated tests covering:
- Two agents exchanging multiple messages in one conversation.
- Incoming and unread message retrieval.
- Read-status updates.
- Conversation history and pagination.
- Cross-workspace and non-participant access denial.
- Token revocation.
- Duplicate requests and concurrent operations.
- Existing MCP task delegation and approval regression tests.

Run the build, type checks and existing test suites.

At completion, report the migration files, API endpoints, MCP tools, tests actually run, deployment requirements, and any remaining limitations.

Do not claim automatic agent wake-up or universal client compatibility unless those capabilities have been implemented and verified.