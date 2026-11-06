# Send guards

The panel is the person's own WhatsApp, linked as a device. Three rules run in
the page, in `recipe/guard.js`, before a notice leaves and before a message is
written. The official source does not send; its contacts are already keyed by
phone number or business id, and it never stores message text
([official-source.md](official-source.md)).

| Rule | What it does |
|---|---|
| Allowed chat | A person is allowed by phone number. A group is allowed by its group id. The name WhatsApp shows is not an id. |
| Wrote first | On this personal number, nothing is sent to a chat that has not written first. |
| Confirm the text | Every send still needs a confirmation of that exact text. One confirmation sends once. |

Open the chat and use **Allow** followed by the number or the group id. **Remove**
takes it off the list. A chat with no phone number yet cannot be allowed; it
stays out until WhatsApp shows a number.

Until a chat is allowed, a new message in it produces no note. The text is not
put in the notice and not written to the extension's storage. The page remembers
only that the id has written, and when, so a later allow does not start the
conversation.

## Decision table

`recipe/guard.js` decides a send from four facts. The rows are the tests in
`test/guards.test.mjs`. "First message" means this side would be writing first.
"Reply" means the chat has already written. "With OK" means a confirmation of
this exact text is in hand. A group and an individual follow the same rule.

| Allowed | Direction | Confirmation | Kind | Result |
|---|---|---|---|---|
| No | First message | Without OK | Individual | Refuse. The chat is not allowed. |
| No | First message | With OK | Individual | Refuse. The chat is not allowed. |
| No | Reply | Without OK | Individual | Refuse. The chat is not allowed. |
| No | Reply | With OK | Individual | Refuse. The chat is not allowed. |
| Yes | First message | Without OK | Individual | Refuse. The chat has not written. |
| Yes | First message | With OK | Individual | Refuse. The chat has not written. |
| Yes | Reply | Without OK | Individual | Refuse. The text is not confirmed. |
| Yes | Reply | With OK | Individual | Send. |
| No | First message | Without OK | Group | Refuse. The chat is not allowed. |
| No | First message | With OK | Group | Refuse. The chat is not allowed. |
| No | Reply | Without OK | Group | Refuse. The chat is not allowed. |
| No | Reply | With OK | Group | Refuse. The chat is not allowed. |
| Yes | First message | Without OK | Group | Refuse. The chat has not written. |
| Yes | First message | With OK | Group | Refuse. The chat has not written. |
| Yes | Reply | Without OK | Group | Refuse. The text is not confirmed. |
| Yes | Reply | With OK | Group | Send. |

A chat with no phone number and no group id is refused, and a blank text is
not a confirmation. For a message coming in, the OK and who spoke do not
matter: an unlisted chat is dropped, and an allowed one may be forwarded.
The text of a dropped chat is not kept.

Entering in the composer, or the send button, hits this table before WhatsApp
writes. Shift+Enter stays a newline. The confirmation shows the exact text and
the id. **Send** there is the confirmation; **Cancel** drops it. The next send
needs its own confirmation.

## Names saved earlier

A list of names can be migrated when the chat list is on screen. A value that
is only a phone number becomes that number (the full number WhatsApp shows, when
exactly one chat matches). A value that is a group id stays that id. A name
becomes an id only when exactly one visible chat has it, and that chat has a
phone number or a group id.

| The saved value | Result |
|---|---|
| Exactly one visible group of that name | That group's id |
| Exactly one visible person of that name, with a phone number | That phone number |
| A phone number, or one that matches exactly one visible number | That phone number |
| A group id | That group id |
| Two chats with the name, or two numbers that both match | Unresolved: ambiguous |
| One chat, and it has no phone number or group id | Unresolved: no phone |
| No visible chat of that name | Unresolved: not seen yet |
| The same id a second time | Unresolved: duplicate |

Unresolved names stay in the list and are tried again when the chat list
changes. The header says how many are left. Allowing the open chat by its id
does not depend on the name.

What this cannot see: the names typed in COGNIX[WS]'s **Notifications…**
dialog. That dialog lives in COGNIX[WS], and the page is not told which chats
were chosen there. Those names are not migrated. Notifications… still chooses
who hears a note, but only a chat allowed here produces a note at all.

To migrate a name list the page can see, store a JSON array of strings under
the key `picode-whatsapp-allow-names` in the panel page's own storage. Names
that resolve are removed from it. The key is not read from COGNIX[WS].

## What the page stores

| Key | Contents |
|---|---|
| `picode-whatsapp-allow-v1` | Phone numbers and group ids, with the kind and the name last seen. No message text. |
| `picode-whatsapp-wrote-v1` | Id to the time it last wrote. No message text. |
| `picode-whatsapp-allow-names` | Names not yet resolved. |

A display name cannot be stored as an id. A lid with no phone number is not an id.

## Limits

The confirmation is a control in the page. An agent that can click the page can
click **Send**. The skill tells it not to. A confirmation the agent cannot
reach would be a COGNIX[WS] approval outside the page; that door was not added.

Reading the **Notifications…** list from the page would be a door the other
way: COGNIX[WS] telling the page which ids the person allowed. That was not
added either. The allow-list this file enforces is the one in the panel.
