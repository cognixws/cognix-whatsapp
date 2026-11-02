# picode-whatsapp

A COGNIX[WS] extension: WhatsApp Web in the panel beside your agents, fitted
to the panel's width, and notifications when a chat gets new messages, to
your Inbox and, if you choose, to an Assistant or an agent.

## What you need

- COGNIX[WS] with manifest version 9 and the desktop app (Windows). The panel
  and its notifications live in the desktop app, so it must be open.
- A WhatsApp account you can link as a device (Settings ▸ Linked devices on
  your phone). WhatsApp Business works too.

## Install

1. In COGNIX[WS], open **Extensions ▸ Add** and enter
   `https://github.com/cognixws/picode-whatsapp`.
2. Review what it adds and install it.
3. Turn it on in the workspaces whose agents should use it. Assistants can
   open it whatever workspace it is on in.

WhatsApp appears as a tile in **Apps** and under **From extensions** in an
agent's **Open beside** menu.

## Set it up

1. **Sign in.** Open the WhatsApp tile and scan the QR code with your phone
   (WhatsApp ▸ Linked devices ▸ Link a device). The session stays in the app's
   own profile, apart from your other browsers.
2. **Keep it running.** In the tile's menu, choose **Keep running in the
   background**. Without it, closing WhatsApp's tab closes the page, and
   nothing can notice new messages. With it, closing the tab only hides the
   page, and it keeps receiving messages.
3. **Choose who hears about new messages.** In the tile's menu, choose
   **Notifications…**:
   - **A note in my Inbox** (on by default): one note per chat with new
     messages, for example "WhatsApp: 3 unread in Family".
   - **Also tell**: add an Assistant or an agent that should hear about it,
     as many as you want (with COGNIX[WS] newer than November 2026; up to 8
     before that). For each, leave **Only these chats** empty to hear about every
     chat, or type chat names separated by commas (`Family, Work team`). A
     name must be written as WhatsApp shows it in the chat list; case does
     not matter.

   Save. The Inbox and the people you added are independent: you can turn the
   Inbox off and keep an Assistant hearing one group.

The tile shows how many chats have unread messages, also while the app is
hidden.

## What an Assistant or an agent receives

A message from the WhatsApp extension, for example:

> WhatsApp: 2 unread in Family. To read it, open WhatsApp beside you:
> tabs new {panel: "whatsapp/web"}.

- An **Assistant** gets it as a turn in its conversation and answers there.
  Give it instructions for what to do with these notes (summarize, tell you
  only about urgent ones, draft a reply for you to send…).
- An **agent** gets it typed into its terminal, like any message between
  agents, when it can take a prompt: while it works, the message waits.

The note carries the chat's name and the unread count, never the message.
To read it, the Assistant or agent opens the panel beside itself and uses the
browser tools inside web.whatsapp.com only.

Bursts are gathered: one chat produces at most one delivery per minute, which
says how many updates it gathered. Each app delivers at most 30 times an hour,
and the next note after a pause says how many were held back.

## What an agent can do in the panel

The `whatsapp-panel` skill teaches an agent to read, send and handle media in the
panel, and asks for your OK on each message sent.

## The official source

Besides the panel, the extension can hear about messages through Meta's official
WhatsApp API and a small relay in your own Cloudflare account, with no panel
open. It is optional and receives only. Each contact can tell as many agents and
Assistants as you want: see [docs/official-source.md](docs/official-source.md). With no relay set,
the extension works as a panel, as before. It needs Node.js 24 for this part.

## Use it with your agents

With the extension on in a workspace, its agents (and every Assistant) can:

- open the panel: `tabs new {panel: "whatsapp/web"}`;
- read and act in it with the browser tools, inside web.whatsapp.com only;
- keep a layout fix with `adjust save` (you undo it from the tab's menu).

In an agent's pane, the tab's ×, or **Disconnect** in its menu, gives
WhatsApp back to the app strip; there, its × hides it while it keeps running.

## How it works

- `recipe/narrow.css` puts WhatsApp in one column below 960px: the chat list
  with no chat open, the conversation with one open, and the other screens
  (Status, Channels, Communities, Calls, Tools, Settings, profile, the media
  gallery) fitted to the panel's width.
- `recipe/back.js` adds the arrow that goes from a conversation back to the
  list (it sends Esc to WhatsApp).
- `recipe/signals.js` watches the chat list's names and unread counts and
  reports them with `picode.badge` (the tile count) and `picode.signal`
  (a chat with new messages). COGNIX[WS] checks each signal against what the
  manifest declares and delivers it where you chose.
- `recipe/attention.js` tells you once when the page can no longer notice
  messages: WhatsApp asks for the QR code again, or its page changed so that
  the chat list cannot be read. It goes where the notes go, as "WhatsApp needs
  you: …", and to the agents that hear every chat, not to those limited to
  some chats.

COGNIX[WS] applies the recipe before every page of the app loads, so a
reload, closing the panel or restarting the app keep it. The scripts read no
messages, and nothing of your account leaves your computer through this
extension.

## When something does not work

| You see | Do this |
|---|---|
| No notes at all | Check Keep running is on and the desktop app is open; open the tile's Notifications… and check the Inbox box or a route is set |
| A chat never reaches its Assistant | Check the chat's name in Notifications… matches the name in WhatsApp's list |
| "WhatsApp's notifications cannot reach COGNIX[WS]: …" | Update COGNIX[WS]; the message names what failed |
| The tab says "recipe out of date" | WhatsApp changed its page; update the extension, or ask an agent to adjust the layout and `adjust save` it |
| WhatsApp asks for the QR code again | Your phone unlinked the device; link it again. You get "WhatsApp needs you" about 30 seconds after it happens |

## Use and WhatsApp's terms

This extension changes how WhatsApp Web is laid out in your own window and
tells you about new messages. How you and your agents use your account is
governed by
[WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service),
which restrict automated and bulk messaging and non-personal use. Notifications
only tell; an agent should reply only when you ask it to.

## Backlog

What is left for this extension is in [BACKLOG.md](BACKLOG.md).

## License

Apache-2.0
