# Intent: Know when an agent needs you

Author: Kaloyan (owner). Status: draft.
Origin: idea (gap analysis against VS Code, 2026-10-30). Issue: none.

## Problem
I run several agents across several workspaces, but I can only tell an agent has finished or is waiting for me by looking at its tile. The status pill lives on the tile alone (`apps/ide/src/renderer/src/components/AgentTerminal.tsx:295`), and the sidebar only says how many agents a workspace has, like "4 agents" (`WorkspaceSidebar.tsx:52-55`). When Squadstorm is in the background, or another workspace is on screen, nothing reaches me, so agents sit idle waiting for an answer while I don't know.

## Proposed outcome
- I get a macOS notification when an agent finishes its work or is waiting for my input.
- Clicking the notification brings me to that agent's tile, in the right workspace.
- The dock icon shows how many agents are waiting on me.
- Each workspace in the sidebar shows at a glance how many agents are working and how many are waiting.
- An agent that finished while I wasn't looking stands out until I look at it.

## Affected users and systems
Anyone running agents in parallel. Squadstorm IDE: agent tiles, workspace sidebar, the macOS dock and Notification Center.

## Constraints
- Works for every provider (Claude, Codex) without configuring the CLIs.
- No notification noise while I'm actively typing into that agent.
- Plain Terminal tiles shouldn't raise notifications for routine output.

## Out of scope
- Notifications to phone, Slack or email.
- Showing the agent's pending tool approvals in Squadstorm (the CLIs handle approvals).
- Sounds or notification settings beyond what macOS already offers.

## Success criteria
- With the app in the background, an agent that stops working produces one macOS notification naming the agent and workspace.
- Clicking the notification shows that agent's tile.
- The sidebar shows working/waiting counts per workspace that match the tiles.
- The dock badge count matches the number of agents waiting and clears once I've seen them.

## Open questions
- Which signals mean "needs you"? The activity going quiet, the terminal bell, or the notifications Claude Code and Codex can emit (OSC 9)?
- Notify only while the window is unfocused, or also when the agent's workspace or tile is off-screen?
- When does an agent stop counting as "waiting": when I focus its tile, or when I type into it?
