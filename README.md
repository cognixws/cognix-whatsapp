# picode-whatsapp

A COGNIX[WS] extension: WhatsApp Web in the panel beside your agents, fitted
to the panel's width, and notifications when a chat gets new messages, to
your Inbox and, if you choose, to an Assistant or an agent.

## What you need

- COGNIX[WS] with manifest version 21 and the desktop app (Windows). The panel
  and its notifications live in the desktop app, so it must be open. With an
  older COGNIX[WS] this version does not install; 0.6.x keeps working there.
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
3. **Allow chats by id.** Open a chat and choose **Allow** followed by its
   phone number, or **Allow group** followed by the group id. A name is not
   enough, and a chat that has no number yet cannot be allowed. Only an
   allowed chat produces a note. **Remove** takes it off the list.
4. **Choose who hears each chat.** In the tile's menu, choose **Chats…**. It
   is the same list: what you allow in the panel shows there within a second,
   and what you add or remove there reaches the panel.
   - **A note in my Inbox** (on by default): one note per chat with new
     messages, for example "WhatsApp: 3 unread in Family".
   - **Who hears**, on each chat's row: add an Assistant or an agent that
     should hear about that chat, or remove one. Every change applies at
     once.

   The list lives in COGNIX[WS], not in the panel's page: clearing WhatsApp's
   data or linking another session keeps it. The first time this version
   loads, the page moves the chats it had allowed itself into COGNIX[WS].
   Names typed in the old Notifications… move to their chat once you allow
   that chat; until then **Chats…** shows them as names without an id.

The tile shows how many chats have unread messages, also while the app is
hidden. A chat that is not allowed does not produce a note, so after this
version the notes stay quiet until you allow the chats you want.

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
panel. A send is refused unless that chat is allowed and has written to you
first. Then the page holds it and COGNIX[WS] asks you on a card in your Inbox,
on the desktop or the phone, showing that exact text:

- **Send** sends it once.
- **Send and allow next** sends it and lets that agent or Assistant reply
  alone in that chat until the time you pick (10 minutes to always, or a
  custom time). Only within 24 hours of the chat's last message, and at most
  20 replies an hour; past either, a card asks again.
- **Don't send** keeps it unsent, and the agent is told.

What you type yourself in a panel no agent is using sends as before, with no
card. You end a permission in the tile's **Chats…** or in **Remembered
approvals**, also from your phone. See [docs/send-guards.md](docs/send-guards.md).

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
  reports an allowed chat with `picode.badge` (the tile count) and
  `picode.signal` (a chat with new messages). COGNIX[WS] checks each signal
  against what the manifest declares and delivers it where you chose.
- `recipe/guard.js` allows chats by phone number or group id, drops every
  other chat before its text is reported, and refuses a send that would write
  first or that you have not confirmed.
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
| No notes at all | Check Keep running is on and the desktop app is open; open the tile's Chats… and check the Inbox switch or a chat's Who hears |
| A chat never reaches its Assistant | Open the chat and Allow its number or group id, then add the Assistant to that chat's Who hears in Chats… |
| "WhatsApp's notifications cannot reach COGNIX[WS]: …" | Update COGNIX[WS]; the message names what failed |
| The tab says "recipe out of date" | WhatsApp changed its page; update the extension, or ask an agent to adjust the layout and `adjust save` it |
| WhatsApp asks for the QR code again | Your phone unlinked the device; link it again. You get "WhatsApp needs you" about 30 seconds after it happens |

## Use and WhatsApp's terms

This extension changes how WhatsApp Web is laid out in your own window and
tells you about new messages. How you and your agents use your account is
governed by
[WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service),
which restrict automated and bulk messaging and non-personal use. Notifications
only tell about chats you allowed. An agent can reply only in a chat that
wrote first, and only after your OK for that exact message, or within a
permission you gave for that chat.

## Backlog

What is left for this extension is in [BACKLOG.md](BACKLOG.md).

## License

Apache-2.0
