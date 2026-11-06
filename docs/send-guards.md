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
| Confirm the text | Every send still needs the person's OK for that exact text. One OK sends once. From 0.8.0 the OK is a card in COGNIX[WS], or a permission the person gave there for that agent and chat. |

Open the chat and use **Allow** followed by the number or the group id. **Remove**
takes it off the list. A chat whose phone number WhatsApp does not have, and
which is not a group, cannot be allowed.

From 0.7.0 (COGNIX[WS] manifest version 21, door N of ADR-0403) the list lives
in COGNIX[WS]. **Allow** and **Remove** write there through
`picode.subjects`; COGNIX[WS] sends the list back on every change and the page
keeps it as a read-only copy (`picode-whatsapp-subjects-cache-v1`), so a reload
has it before COGNIX[WS] answers. **Chats…** in the tile's menu is the same
list. The first load imports the page's own list once and clears it. COGNIX[WS]
also drops a signal about a chat that is not on its list.

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

## The OK in COGNIX[WS] (0.8.0)

With COGNIX[WS]'s door O (`picode.ask`, ADR-0403) the confirmation bar is
gone. Enter (or the send button) runs the first two rows of the table above
in the page; a chat that passes them is held, and the page asks COGNIX[WS]
`send` with the chat's id, the exact text, whether it wrote first and when it
last wrote. COGNIX[WS] decides from who is using the panel:

| COGNIX[WS] answers | The page |
|---|---|
| send (the person typed it, or a permission covers it) | Lets that Enter through once and shows "Sent." or "Sent (allowed until …)." |
| wait (a card is in the Inbox) | Shows "Waiting for your OK in COGNIX[WS]." with Cancel; Enter again does not ask twice |
| send, later (the card's Send) | Sends only if the composer still holds that text for that chat; otherwise "Not sent: the message changed…" and COGNIX[WS] hears it was not sent |
| deny (Don't send) | "Not sent: the person declined." and the composer is cleared |
| a yes for a request the page no longer holds | Nothing is sent; COGNIX[WS] marks the card "Not sent: the panel was closed" |

The decision table COGNIX[WS] runs (who sends, the permission, the 24-hour
window, the 20-an-hour ceiling, Pause all) is in COGNIX[WS]'s
`docs/architecture/webapp-actions.md`. With an older COGNIX[WS] the page keeps
the 0.6 confirmation bar.

## A chat id that is a lid

WhatsApp Web now addresses a saved contact as `<lid>@lid`. The lid is not a
phone number, and it is not an id this page will store. Seen on 2026-11-06 in
WhatsApp Business: the open chat was "Carlos Perche", the header said "No
number yet", and every send was refused with "This chat has no phone number
or group id, so nothing is sent." The number was on the account anyway
(`+55 19 98346-…` in the contact info). The chat model carried the `@lid` and
no `contact.phoneNumber`, which is the only place the previous guard looked,
besides a chat id on `@c.us` or `@s.whatsapp.net`.

The phone is taken from data the page already has, in this order. Nothing
here asks WhatsApp's servers (`queryWidExists` is not called). If none of
these yield one phone number of 8 to 15 digits, the chat is refused with the
same sentence.

| Where | What is read |
|---|---|
| The loaded chat | `contact.phoneNumber`, `phoneNumber`, `pnJid`, `contact.pnJid`, `contact.formattedPhone`, and `contact.id` when its host is `c.us` or `s.whatsapp.net`. A wid counts with `_serialized`, or with `user` and that host. A `@lid` user is never the phone, whatever its length. A device suffix (`:12`) is not part of the number. |
| WhatsApp's lid map | `WAWebApiContact.getPhoneNumber(lidWid)`, the same local map `lidPnCache.getPhoneNumber` wraps, then `getLidEntry` if the first returns nothing. The wid is the chat's own `id`. The module is `require('WAWebApiContact')` when the page exposes `require`; otherwise it is an already-evaluated webpack module that exports `getPhoneNumber` and `getCurrentLid` (or `lidPnCache` with those two). The lookup does not run module factories. |
| The open contact info | The single international number shown there (`+…`), and only for the chat that is open. The drawer's contact id is that `@lid`, or its title is that chat's name. The drawer's own props are read first (`[data-testid="contact-info-drawer"]`, otherwise `[data-testid="drawer-right"]`); the visible text is the fallback. Two different numbers is not an id. |

The map is what lets a saved contact be allowed, and what lets a note leave,
without opening the contact info. The list and the header both use it. The
drawer covers the open chat when the map is not readable yet. The id that is
stored is still the phone, or the group id. A display name is still not an id.

An unsaved chat whose id is already `@c.us` or `@s.whatsapp.net` stays that
number, and a group stays its `@g.us` id. Neither is passed through the lid map.

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

What this cannot see: the names typed in COGNIX[WS]'s old **Notifications…**
dialog. From 0.7.0 COGNIX[WS] moves those itself, in **Chats…**, once the chat
they name is on the list.

To migrate a name list the page can see, store a JSON array of strings under
the key `picode-whatsapp-allow-names` in the panel page's own storage. Names
that resolve are removed from it. The key is not read from COGNIX[WS].

## What the page stores

| Key | Contents |
|---|---|
| `picode-whatsapp-allow-v1` | Phone numbers and group ids, with the kind and the name last seen. No message text. Empty after the 0.7.0 import. |
| `picode-whatsapp-subjects-cache-v1` | The copy of COGNIX[WS]'s list (0.7.0). |
| `picode-whatsapp-allow-imported` | When the old list was moved to COGNIX[WS]. |
| `picode-whatsapp-wrote-v1` | Id to the time it last wrote. No message text. |
| `picode-whatsapp-allow-names` | Names not yet resolved. |

A display name cannot be stored as an id. A lid is not an id. A lid whose phone
number the page cannot resolve is not stored.

## Limits

Before 0.8.0 the confirmation was a control in the page, and an agent that can
click the page could click **Send**. From 0.8.0 the OK is a COGNIX[WS] Inbox
card that only the person's own browser or app answers.

From 0.7.0 that door exists: COGNIX[WS] tells the page which ids the person
allowed (door N). The list the page enforces is COGNIX[WS]'s.

### The open chat's model (0.6.2)

On 2026-11-06 WhatsApp Web stopped carrying the chat model where the guard
looked for it (the selected row's and `#main`'s React props), so even a lid
with a known phone read "No number yet". The guard now falls back to
WhatsApp's own active chat (`WAWebChatCollection`), read only. Verified
live: the saved contact "Carlos Perche" (`…@lid`) resolves to its phone.
